package server

// The RevenueCat-compatible SDK API. A port of lite/src/routes/sdk.ts.
//
// Wire rules from spec/sdk-wire-contract.md:
//   - Never answer 304 to an SDK key; always 200 with a full body (iOS can re-queue a 304 forever).
//   - Every error has a JSON body {code, message} with Content-Type application/json, or Android
//     treats it as a connection failure.
//   - On /receipts, a 4xx makes the device finish (iOS) or acknowledge (Android) the purchase.
//     Anything retryable, including our own config mistakes, must be a 5xx so the purchase stays
//     queued on the device.
//   - Remote config gets 204, which both SDKs read as "not modified".
//   - User IDs arrive percent-encoded on Android and raw ($, :) on iOS; both are decoded.

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/openpurr/openpurr/standard/internal/applereceipt"
	"github.com/openpurr/openpurr/standard/internal/config"
	"github.com/openpurr/openpurr/standard/internal/customerinfo"
	"github.com/openpurr/openpurr/standard/internal/jsobj"
	"github.com/openpurr/openpurr/standard/internal/ledger"
	"github.com/openpurr/openpurr/standard/internal/secretkeys"
)

// Backend error codes the SDKs recognize (iOS BackendErrorCode.swift, Android errors.kt).
const (
	codeUnknownError                = 0
	codeInternalServerError         = 7110
	codeInvalidAPIKey               = 7225
	codeBadRequest                  = 7226
	codeInvalidSubscriberAttributes = 7263
)

// The largest request body read; anything bigger is treated as unreadable JSON.
const maxBodyBytes = 4 << 20

// sdkRequest is one SDK API request after authentication.
type sdkRequest struct {
	w      http.ResponseWriter
	r      *http.Request
	config *config.Config
	// The caller's project.
	project *config.Project
	// Set for public SDK keys.
	app *config.App
	// Set for secret (server-to-server) keys.
	key  *secretkeys.Key
	now  int64
	body []byte

	parsed     bool
	bodyValue  any
	bodyIsJSON bool
}

// json is the parsed body, like Hono's `c.req.json().catch(() => null)`: nil, false when it
// isn't JSON.
func (q *sdkRequest) json() (any, bool) {
	if !q.parsed {
		q.parsed = true
		v, err := jsobj.Parse(q.body)
		q.bodyValue, q.bodyIsJSON = v, err == nil
	}
	return q.bodyValue, q.bodyIsJSON
}

// prop is `body?.k`.
func (q *sdkRequest) prop(k string) (any, bool) {
	v, ok := q.json()
	if !ok {
		return nil, false
	}
	return jsobj.Prop(v, k)
}

func sdkError(w http.ResponseWriter, status, code int, message string) {
	writeJSON(w, status, jsobj.New("code", float64(code), "message", message))
}

// rateLimited answers a request over a limit. /receipts answers 503, never 429: a 4xx there makes
// Android acknowledge the purchase as handled, so it would never be retried. 503 keeps it queued
// on the device.
func rateLimited(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Retry-After", "60")
	if strings.HasSuffix(r.URL.Path, "/receipts") {
		sdkError(w, http.StatusServiceUnavailable, codeInternalServerError, "Too many requests; the purchase will be retried.")
		return
	}
	sdkError(w, http.StatusTooManyRequests, codeUnknownError, "Too many requests.")
}

func bearer(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return jsobj.Trim(auth[7:])
}

var (
	secretKeyPath   = regexp.MustCompile(`^/v1/subscribers/[^/]+$`)
	subscriberInURL = regexp.MustCompile(`/subscribers/([^/]+)`)
)

// safeDecode is decodeURIComponent, keeping the input when it isn't valid: iOS sends user IDs raw,
// Android percent-encoded, and both must count as one user.
func safeDecode(s string) string {
	if !strings.Contains(s, "%") {
		return s
	}
	d, err := url.PathUnescape(s)
	if err != nil || !utf8.ValidString(d) {
		return s
	}
	return d
}

// sdk runs the middleware Lite runs on every /v1 request (per-IP limit, key check, per-user
// limit) and then the route.
func (s *server) sdk(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	cfg, err := s.Config.Get(ctx)
	if err != nil {
		s.internalError(w, r, err)
		return
	}
	q := &sdkRequest{w: w, r: r, config: cfg, now: s.Clock.Now()}
	if r.Body != nil {
		q.body, _ = io.ReadAll(io.LimitReader(r.Body, maxBodyBytes+1))
		if len(q.body) > maxBodyBytes {
			q.body = nil
		}
	}

	// Per client IP, before the key check, so it also slows down anyone guessing keys. Secret-key
	// requests are exempt here (a backend often calls from one IP); their failures count below.
	key := bearer(r)
	ip := s.clientIP(r)
	if !strings.HasPrefix(key, secretkeys.Prefix) {
		if l := s.Limiters.IP; l != nil && ip != "" && !l.Allow(ctx, ip) {
			rateLimited(w, r)
			return
		}
	}

	// The key identifies the caller and its project. A public SDK key identifies the app (and so
	// the store and project). A secret key identifies a server, which may only read its project's
	// customers.
	if strings.HasPrefix(key, secretkeys.Prefix) {
		secret, err := s.SecretKeys.Verify(ctx, s.Pool, key, q.now)
		if err != nil {
			s.internalError(w, r, err)
			return
		}
		if secret == nil {
			if l := s.Limiters.IP; l != nil && ip != "" && !l.Allow(ctx, ip) {
				rateLimited(w, r)
				return
			}
			sdkError(w, http.StatusUnauthorized, codeInvalidAPIKey, "Invalid API key.")
			return
		}
		if r.Method != http.MethodGet || !secretKeyPath.MatchString(r.URL.EscapedPath()) {
			sdkError(w, http.StatusForbidden, codeInvalidAPIKey, "Secret keys can only read customers: GET /v1/subscribers/{app_user_id}.")
			return
		}
		project := cfg.Projects[secret.ProjectID]
		if project == nil {
			sdkError(w, http.StatusUnauthorized, codeInvalidAPIKey, "This key's project no longer exists.")
			return
		}
		q.key, q.project = secret, project
		if secret.TouchDue(q.now) {
			id, now := secret.ID, q.now
			s.Deferred.Go("touch secret key", func(ctx context.Context) error { return secretkeys.Touch(ctx, s.Pool, id, now) })
		}
	} else {
		var app *config.App
		if key != "" {
			app = cfg.Keys[key]
		}
		if app == nil {
			sdkError(w, http.StatusUnauthorized, codeInvalidAPIKey, "Invalid API key.")
			return
		}
		q.app, q.project = app, cfg.Projects[app.ProjectID]
	}

	// Per app user ID: one user hammering the server (a runaway retry loop, say) can't use up the
	// whole app's budget. The SDK key is shared by every user of an app, so it can't be the key.
	if l := s.Limiters.User; l != nil {
		userID := ""
		if m := subscriberInURL.FindStringSubmatch(r.URL.EscapedPath()); m != nil && m[1] != "identify" {
			userID = m[1]
		}
		if userID == "" && r.Method == http.MethodPost {
			if v, ok := q.prop("app_user_id"); ok {
				userID, _ = v.(string)
			}
		}
		caller := ""
		if q.key != nil {
			caller = q.key.ID
		} else {
			caller = q.app.ID
		}
		if userID != "" && !l.Allow(ctx, caller+":"+safeDecode(userID)) {
			rateLimited(w, r)
			return
		}
	}

	s.sdkRoute(q)
}

// sdkRoutes maps SDK paths to handlers, with Go 1.22 patterns.
func (s *server) sdkRoutes() *http.ServeMux {
	mux := http.NewServeMux()
	handle := func(pattern string, h func(*sdkRequest) error) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			q := r.Context().Value(sdkRequestKey{}).(*sdkRequest)
			q.r = r
			if err := h(q); err != nil {
				s.internalError(w, r, err)
			}
		})
	}
	handle("GET /v1/subscribers/{id}", s.getCustomerInfo)
	handle("POST /v1/receipts", s.postReceipt)
	handle("POST /v1/subscribers/identify", s.identify)
	handle("POST /v1/subscribers/{id}/alias", s.alias)
	handle("GET /v1/subscribers/{id}/offerings", s.offerings)
	handle("GET /v1/product_entitlement_mapping", s.productEntitlementMapping)
	handle("POST /v1/subscribers/{id}/attributes", s.postAttributes)
	handle("POST /v1/subscribers/{id}/intro_eligibility", s.introEligibility)
	// Remote config: 204 = not modified. Without config, diagnostics stay off (the default).
	handle("POST /v1/config/{domain}", func(q *sdkRequest) error {
		q.w.WriteHeader(http.StatusNoContent)
		return nil
	})
	// Fire-and-forget. 2xx clears the SDK's queue; 404/5xx would make it retry forever.
	handle("POST /v1/events", func(q *sdkRequest) error { writeJSON(q.w, http.StatusOK, jsobj.New()); return nil })
	handle("POST /v1/diagnostics", func(q *sdkRequest) error { writeJSON(q.w, http.StatusOK, jsobj.New()); return nil })
	handle("/", func(q *sdkRequest) error {
		notImplemented(q.w, q.r)
		return nil
	})
	return mux
}

type sdkRequestKey struct{}

func notImplemented(w http.ResponseWriter, r *http.Request) {
	sdkError(w, http.StatusNotFound, codeUnknownError, "Not implemented: "+r.Method+" "+r.URL.EscapedPath())
}

// cleanPath reports whether ServeMux would take the path as is (no empty, "." or ".." segments);
// it redirects the others, which the SDKs can't follow, so they're answered here instead.
func cleanPath(p string) bool {
	return !strings.Contains(p, "//") && !strings.Contains(p, "/./") && !strings.Contains(p, "/../") &&
		!strings.HasSuffix(p, "/.") && !strings.HasSuffix(p, "/..")
}

func (s *server) sdkRoute(q *sdkRequest) {
	if !cleanPath(q.r.URL.EscapedPath()) {
		notImplemented(q.w, q.r)
		return
	}
	s.sdkMuxOnce.Do(func() { s.sdkMux = s.sdkRoutes() })
	r := q.r.WithContext(context.WithValue(q.r.Context(), sdkRequestKey{}, q))
	s.sdkMux.ServeHTTP(q.w, r)
}

// userID is the decoded {id} path segment.
func (q *sdkRequest) userID() string {
	return q.r.PathValue("id")
}

// renderOptions are the per-request CustomerInfo inputs.
func (q *sdkRequest) renderOptions() customerinfo.RenderOptions {
	opts := customerinfo.RenderOptions{Now: q.now}
	if q.app != nil {
		opts.RequestStore = string(q.app.Store)
	}
	return opts
}

// GET /v1/subscribers/{id}: one query when the customer's snapshot is current. Never a 304 to an
// SDK key: the SDK may have nothing cached to fall back on.
func (s *server) getCustomerInfo(q *sdkRequest) error {
	if q.key != nil {
		return s.serverCustomerInfo(q)
	}
	read, err := customerinfo.ReadCustomerInfo(q.r.Context(), s.Pool, q.project, q.userID(), q.renderOptions())
	if err != nil {
		return err
	}
	if read.ETag != "" {
		q.w.Header().Set("ETag", read.ETag)
	}
	writeJSON(q.w, http.StatusOK, read.Body)
	return nil
}

// serverCustomerInfo is the server-to-server read (secret key): the same CustomerInfo plus
// subscriber_attributes, which RevenueCat also returns only to secret keys. Supports
// If-None-Match. Attribute changes don't rebuild snapshots, so this ETag covers both the
// CustomerInfo and the attributes.
func (s *server) serverCustomerInfo(q *sdkRequest) error {
	if !q.key.Scopes["customers:read"] {
		sdkError(q.w, http.StatusForbidden, codeInvalidAPIKey, "This key lacks the customers:read scope.")
		return nil
	}
	ctx := q.r.Context()
	read, err := customerinfo.ReadCustomerInfo(ctx, s.Pool, q.project, q.userID(), q.renderOptions())
	if err != nil {
		return err
	}
	attributes := jsobj.New()
	if read.CustomerID != "" {
		if attributes, err = ledger.ReadAttributes(ctx, s.Pool, read.CustomerID); err != nil {
			return err
		}
	}
	subV, _ := read.Body.Get("subscriber")
	sub := subV.(*jsobj.Object)
	subscriber := jsobj.New()
	stable := jsobj.New()
	for _, k := range sub.Keys() {
		v, _ := sub.Get(k)
		if k == "subscriber_attributes" {
			v = attributes
		}
		subscriber.Set(k, v)
		if k != "last_seen" {
			stable.Set(k, v)
		}
	}
	etag := customerinfo.ETagOf(jsobj.Stringify(stable))
	q.w.Header().Set("ETag", etag)
	if inm := q.r.Header.Get("If-None-Match"); inm != "" {
		for _, t := range strings.Split(inm, ",") {
			if strings.TrimSpace(t) == etag {
				q.w.WriteHeader(http.StatusNotModified)
				return nil
			}
		}
	}
	read.Body.Set("subscriber", subscriber)
	writeJSON(q.w, http.StatusOK, read.Body)
	return nil
}

// truthy is JavaScript's truthiness.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && x == x
	case string:
		return x != ""
	}
	return true
}

// idString is how D1 stores a non-string ID bound as a parameter (a number becomes its text).
func idString(v any) string { return jsobj.String(v, true) }

// POST /v1/subscribers/identify (logIn). 201 tells the SDK the user was created; 200 that it
// already existed.
func (s *server) identify(q *sdkRequest) error {
	currentV, _ := q.prop("app_user_id")
	nextV, _ := q.prop("new_app_user_id")
	if !truthy(currentV) || !truthy(nextV) {
		sdkError(q.w, http.StatusBadRequest, codeBadRequest, "app_user_id and new_app_user_id are required.")
		return nil
	}
	current, next := idString(currentV), idString(nextV)
	ctx := q.r.Context()
	projectID := q.project.ID
	from, err := ledger.FindCustomer(ctx, s.Pool, projectID, current)
	if err != nil {
		return err
	}
	to, err := ledger.FindCustomer(ctx, s.Pool, projectID, next)
	if err != nil {
		return err
	}
	created := false
	var customerID string
	switch {
	case to != nil:
		// Logging in to an existing account: an anonymous user's purchases come along.
		if from != nil && from.ID != to.ID && ledger.IsAnonymous(current) {
			tx, err := s.Pool.Begin(ctx)
			if err != nil {
				return err
			}
			if err := ledger.MergeCustomers(ctx, tx, from.ID, to.ID); err != nil {
				_ = tx.Rollback(ctx)
				return err
			}
			if err := tx.Commit(ctx); err != nil {
				return err
			}
		}
		customerID = to.ID
	case from != nil && ledger.IsAnonymous(current):
		// A new ID for an anonymous user who already exists: alias it, keeping their purchases.
		if err := ledger.AddAlias(ctx, s.Pool, projectID, next, from.ID, q.now); err != nil {
			return err
		}
		customerID = from.ID
		created = true
	default:
		c, err := ledger.EnsureCustomer(ctx, s.Pool, projectID, next, q.now)
		if err != nil {
			return err
		}
		customerID = c.ID
		created = true
	}
	body, err := s.freshCustomerInfo(q, customerID, next)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if created {
		status = http.StatusCreated
	}
	writeJSON(q.w, status, body)
	return nil
}

// freshCustomerInfo rebuilds the customer's snapshot after a write and renders it. It falls back
// to a computed read if the rebuild fails (the snapshot is then simply missing until the next
// write).
func (s *server) freshCustomerInfo(q *sdkRequest, customerID, appUserID string) (*jsobj.Object, error) {
	ctx := q.r.Context()
	fresh, err := customerinfo.Refresh(ctx, s.Pool, q.config, customerID, q.now)
	if err != nil {
		s.Log.Error("Snapshot rebuild failed; serving a computed CustomerInfo.", "error", err.Error())
	} else if fresh != nil {
		q.w.Header().Set("ETag", fresh.ETag)
		return customerinfo.Render(fresh.Snapshot, fresh.Project, q.renderOptions()), nil
	}
	read, err := customerinfo.ReadCustomerInfo(ctx, s.Pool, q.project, appUserID, q.renderOptions())
	if err != nil {
		return nil, err
	}
	return read.Body, nil
}

// POST /v1/subscribers/{id}/alias: Android only, Block Store recovery of an anonymous ID. The SDK
// ignores the body.
func (s *server) alias(q *sdkRequest) error {
	writeJSON(q.w, http.StatusOK, jsobj.New())
	return nil
}

// GET /v1/subscribers/{id}/offerings. A running price experiment swaps in the customer's variant
// as the current offering; every offering is still listed.
func (s *server) offerings(q *sdkRequest) error {
	project, app := q.project, q.app
	var current any
	if project.CurrentOffering != nil {
		current = *project.CurrentOffering
	}
	assigned, err := s.Experiments.AssignVariant(q.r.Context(), s.Pool, project.ID, q.userID(), q.now)
	if err != nil {
		return err
	}
	if assigned != nil {
		if assigned.Write != nil {
			write := assigned.Write
			s.Deferred.Go("experiment enrollment", func(ctx context.Context) error { return write(ctx, s.Pool) })
		}
		// An offering removed from the config since the experiment started: the current one instead.
		for _, o := range project.Offerings {
			if o.ID == assigned.Variant.OfferingID {
				current = o.ID
				break
			}
		}
	}
	offerings := make([]any, 0, len(project.Offerings))
	for _, o := range project.Offerings {
		packages := []any{}
		for _, p := range o.Packages {
			ref, ok := p.Products[app.ID]
			if !ok {
				continue
			}
			pkg := jsobj.New("identifier", p.ID, "platform_product_identifier", ref.ProductID)
			if ref.BasePlan() != "" {
				pkg.Set("platform_product_plan_identifier", ref.BasePlan())
			}
			packages = append(packages, pkg)
		}
		offerings = append(offerings, jsobj.New(
			"identifier", o.ID,
			"description", o.Description,
			"metadata", o.Metadata,
			"packages", packages,
		))
	}
	writeJSON(q.w, http.StatusOK, jsobj.New(
		"current_offering_id", current,
		"offerings", offerings,
		"placements", nil,
		"targeting", nil,
	))
	return nil
}

// GET /v1/product_entitlement_mapping lets the SDK compute entitlements offline when the server
// is down.
func (s *server) productEntitlementMapping(q *sdkRequest) error {
	project, app := q.project, q.app
	mapping := jsobj.New()
	add := func(productID string, basePlanID *string, entitlement string) {
		key := productID
		var plan any
		if basePlanID != nil && *basePlanID != "" {
			key = productID + ":" + *basePlanID
			plan = *basePlanID
		} else if basePlanID != nil {
			plan = *basePlanID
		}
		v, ok := mapping.Get(key)
		if !ok {
			v = jsobj.New("product_identifier", productID, "base_plan_id", plan, "entitlements", []any{})
			mapping.Set(key, v)
		}
		entry := v.(*jsobj.Object)
		ents, _ := entry.Get("entitlements")
		list := ents.([]any)
		for _, e := range list {
			if e == entitlement {
				return
			}
		}
		entry.Set("entitlements", append(list, entitlement))
	}
	for _, e := range project.Entitlements {
		for _, ref := range e.Products[app.ID] {
			product := app.Products[ref.ProductID]
			// "pro" on a Play subscription means every base plan; list them when the config names them.
			switch {
			case ref.BasePlan() != "":
				add(ref.ProductID, ref.BasePlanID, e.ID)
			case len(product.BasePlans) > 0:
				for _, plan := range product.BasePlans {
					p := plan
					add(ref.ProductID, &p, e.ID)
				}
			default:
				add(ref.ProductID, nil, e.ID)
			}
		}
	}
	writeJSON(q.w, http.StatusOK, jsobj.New("product_entitlement_mapping", mapping))
	return nil
}

// POST /v1/subscribers/{id}/attributes. The SDK marks attributes synced on 2xx or any 4xx except
// 404, and retries on 5xx or 404. Valid attributes are stored even when others in the same
// request are invalid; the invalid ones are reported with 400 / 7263, which also stops the SDK
// retrying them.
func (s *server) postAttributes(q *sdkRequest) error {
	body, ok := q.json()
	if !ok || !truthy(body) {
		sdkError(q.w, http.StatusBadRequest, codeBadRequest, "Expected a JSON body with attributes.")
		return nil
	}
	raw, defined := jsobj.Prop(body, "attributes")
	updates, errs := ledger.ParseAttributes(raw, defined, q.now)
	if updates.Len() > 0 {
		ctx := q.r.Context()
		customer, err := ledger.EnsureCustomer(ctx, s.Pool, q.project.ID, q.userID(), q.now)
		if err != nil {
			return err
		}
		limitErrs, err := ledger.EnforceCustomLimit(ctx, s.Pool, customer.ID, updates)
		if err != nil {
			return err
		}
		errs = append(errs, limitErrs...)
		if updates.Len() > 0 {
			if err := ledger.WriteAttributes(ctx, s.Pool, customer.ID, updates, q.now); err != nil {
				return err
			}
		}
	}
	if len(errs) > 0 {
		list := make([]any, len(errs))
		for i, e := range errs {
			list[i] = e.JSON()
		}
		writeJSON(q.w, http.StatusBadRequest, jsobj.New(
			"code", float64(codeInvalidSubscriberAttributes),
			"message", "Some subscriber attributes are invalid.",
			"attribute_errors", list,
		))
		return nil
	}
	writeJSON(q.w, http.StatusOK, jsobj.New())
	return nil
}

// POST /v1/subscribers/{id}/intro_eligibility: iOS, StoreKit 1 path only. true, false or null
// (unknown) per product. Read-only.
func (s *server) introEligibility(q *sdkRequest) error {
	var requested []string
	if ids, ok := q.prop("product_identifiers"); ok {
		if list, isList := ids.([]any); isList {
			for _, v := range list {
				if id, isStr := v.(string); isStr {
					requested = append(requested, id)
				}
			}
		}
	}
	if len(requested) > 100 {
		requested = requested[:100]
	}
	var receiptProductIDs []string
	if t, ok := q.prop("fetch_token"); ok {
		if token, isStr := t.(string); isStr && token != "" {
			// A malformed receipt just means we know less; the answer may be null.
			if receipt, err := applereceipt.Parse(token); err == nil {
				receiptProductIDs = receipt.ProductIDs
			}
		}
	}
	ctx := q.r.Context()
	loaded, err := ledger.LoadCustomer(ctx, s.Pool, q.project.ID, q.userID())
	if err != nil {
		return err
	}
	var history []ledger.Transaction
	for _, t := range loaded.Transactions {
		if t.Store == string(config.AppStore) {
			history = append(history, t)
		}
	}
	result, err := ledger.IntroEligibility(ctx, s.Pool, q.app, requested, history, receiptProductIDs)
	if err != nil {
		return err
	}
	writeJSON(q.w, http.StatusOK, result)
	return nil
}
