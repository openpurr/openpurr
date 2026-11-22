// Package config is the openpurr config: projects, and each project's apps, products,
// entitlements, offerings and webhooks. A port of lite/src/config.ts: the same document format
// (version 2, or the single-project version 1 file), the same validation and the same problem
// messages, so a config moves between editions unchanged.
//
// The config lives in the database (config_version; store.go) and is edited through the admin API.
// Every save is validated here first, and the server validates it again when it loads it, so the
// runtime never trusts an unvalidated document.
//
// A project is one title. Customers, secret keys and webhooks belong to a project, so two titles
// in one deployment never share customers or entitlements. App IDs, SDK keys, bundle IDs and
// package names are unique across all projects, because a request or store notification is
// matched to its app (and so its project) by them.
package config

import (
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"strings"

	"github.com/openpurr/openpurr/standard/internal/jsobj"
)

type Store string

const (
	AppStore  Store = "app_store"
	PlayStore Store = "play_store"
)

type ProductType string

const (
	Subscription  ProductType = "subscription"
	NonConsumable ProductType = "non_consumable"
	Consumable    ProductType = "consumable"
)

type Product struct {
	ID   string
	Type ProductType
	// Play subscriptions: the base plans that exist. Optional; used for the entitlement mapping.
	BasePlans []string
	// App Store subscriptions: the subscription group ID ("" when not set). Apple includes it in
	// every transaction, so it's learned once anyone buys the product; setting it here makes
	// intro-offer eligibility work before then.
	SubscriptionGroup string
}

type GooglePlayAPI struct {
	// Name of the secret holding the service account's JSON key.
	ServiceAccountSecret string
	// The service account Pub/Sub uses to sign push requests to /notifications/google.
	PubsubPushAccount string
	// The audience Pub/Sub puts in those tokens; nil means the notification URL.
	PubsubAudience *string
}

type AppStoreServerAPI struct {
	IssuerID string
	KeyID    string
	// Name of the secret (environment variable) holding the In-App Purchase key (.p8).
	PrivateKeySecret string
}

type App struct {
	ID        string
	ProjectID string
	Store     Store
	// App Store: the bundle ID every signed transaction must carry.
	BundleID string
	// Google Play: the package name.
	PackageName string
	SDKKeys     []string
	Products    map[string]*Product
	// Product IDs in config order.
	ProductOrder      []string
	GooglePlayAPI     *GooglePlayAPI
	AppStoreServerAPI *AppStoreServerAPI
	// Development only: accept purchases the server can't verify. Anyone holding the public SDK
	// key could then grant themselves entitlements.
	AllowUnverifiedPurchases bool
}

// ProductRef is "pro" (BasePlanID nil: every base plan) or "pro:monthly".
type ProductRef struct {
	ProductID  string
	BasePlanID *string
}

// BasePlan is the base plan ID, or "" when there is none. ("pro:" names the empty base plan,
// which only matters for entitlement matching, as in Lite.)
func (r ProductRef) BasePlan() string {
	if r.BasePlanID == nil {
		return ""
	}
	return *r.BasePlanID
}

type Entitlement struct {
	ID          string
	Description string
	// Per app: product references.
	Products map[string][]ProductRef
}

type Package struct {
	ID string
	// Per app: product reference, as in entitlements.
	Products map[string]ProductRef
}

type Offering struct {
	ID          string
	Description string
	Metadata    *jsobj.Object
	Packages    []*Package
}

var WebhookEventTypes = []string{
	"INITIAL_PURCHASE",
	"RENEWAL",
	"CANCELLATION",
	"UNCANCELLATION",
	"NON_RENEWING_PURCHASE",
	"EXPIRATION",
	"BILLING_ISSUE",
	"PRODUCT_CHANGE",
	"SUBSCRIPTION_EXTENDED",
	"SUBSCRIPTION_PAUSED",
	"REFUND_REVERSED",
	"TRANSFER",
	"PRICE_INCREASE_CONSENT_REQUIRED",
	"PRICE_INCREASE_CONSENT_APPROVED",
}

type Webhook struct {
	ID  string
	URL string
	// Secret holding the exact Authorization header value to send ("" when none).
	AuthorizationSecret string
	// Secret holding the HMAC signing key ("" when none). During a rotation it may hold two keys
	// separated by a comma; each produces a v1= signature.
	SigningSecret string
	Environments  []string
	// Event types to send; nil means all.
	Events map[string]bool
}

// Project is one title: its apps and everything shared between them.
type Project struct {
	ID   string
	Name string
	// Changes whenever this project's config does; CustomerInfo snapshots built from another
	// version are recomputed.
	Version string
	Apps    map[string]*App
	// App IDs in config order.
	AppOrder        []string
	Webhooks        []*Webhook
	Entitlements    []*Entitlement
	Offerings       []*Offering
	CurrentOffering *string
}

type Config struct {
	// Changes whenever any part of the config does.
	Version  string
	Projects map[string]*Project
	// Project IDs in document order.
	ProjectOrder []string
	// Every app of every project, by app ID.
	Apps map[string]*App
	// SDK key -> app.
	Keys map[string]*App
	// The validated document, as version 2 (what config_version stores).
	Document *jsobj.Object
}

// Error lists every problem found in a document.
type Error struct {
	Problems []string
}

func (e *Error) Error() string {
	lines := make([]string, len(e.Problems))
	for i, p := range e.Problems {
		lines[i] = "  - " + p
	}
	return "Invalid openpurr config:\n" + strings.Join(lines, "\n")
}

var (
	idRE         = regexp.MustCompile(`^[A-Za-z0-9._$-]{1,100}$`)
	projectIDRE  = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,49}$`)
	issuerIDRE   = regexp.MustCompile(`(?i)^[0-9a-f-]{36}$`)
	keyIDRE      = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	secretNameRE = regexp.MustCompile(`^[A-Z][A-Z0-9_]{0,63}$`)
	sdkKeyRE     = regexp.MustCompile(`^[A-Za-z0-9_]{16,128}$`)
	pushAcctRE   = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$`)
)

var keyPrefix = map[Store]string{AppStore: "appl_", PlayStore: "goog_"}
var productTypes = []string{"subscription", "non_consumable", "consumable"}

// DefaultProjectID is the project a version 1 (single-project) file becomes.
const DefaultProjectID = "default"
const defaultProjectName = "Default"

var projectKeys = []string{"name", "apps", "entitlements", "offerings", "webhooks"}

// Upgrade returns a version 1 file as a version 2 document, with everything in the project
// "default". Anything else is returned as is.
func Upgrade(raw any) any {
	doc, ok := raw.(*jsobj.Object)
	if !ok || doc == nil {
		return raw
	}
	if v, ok := doc.Get("version"); !ok || v != 1.0 {
		return raw
	}
	project := jsobj.New("name", defaultProjectName)
	for _, k := range doc.Keys() {
		if k == "version" {
			continue
		}
		v, _ := doc.Get(k)
		project.Set(k, v)
	}
	return jsobj.New("version", 2.0, "projects", jsobj.New(DefaultProjectID, project))
}

// EmptyDocument is a config with no projects yet (a new deployment, before the first app is added).
func EmptyDocument() *jsobj.Object {
	return jsobj.New("version", 2.0, "projects", jsobj.New())
}

type failFunc func(path, msg string)

type globals struct {
	apps     map[string]*App
	appOrder []*App
	keys     map[string]*App
}

// Parse validates and normalizes a config document (version 2, or a version 1 file). It returns
// an *Error listing every problem found.
func Parse(raw any) (*Config, error) {
	var problems []string
	fail := func(path, msg string) { problems = append(problems, path+": "+msg) }

	if !jsobj.IsObject(raw) {
		return nil, &Error{Problems: []string{"the config must be a mapping"}}
	}
	// The returned Config keeps parts of the document, so work on a copy.
	raw = jsobj.CloneValue(raw)
	// A version 1 file's problems keep version 1 paths ("apps.ios...", not "projects.default.apps.ios...").
	v, _ := raw.(*jsobj.Object).Get("version")
	v1 := v == 1.0
	doc := Upgrade(raw).(*jsobj.Object)
	if dv, _ := doc.Get("version"); dv != 2.0 {
		fail("version", "must be 2 (or 1, the single-project file)")
	}
	allowOnly(doc, []string{"version", "projects"}, "", fail)
	rawProjects, hasProjects := doc.Get("projects")
	if hasProjects && !jsobj.IsObject(rawProjects) {
		fail("projects", "must be a mapping of project IDs to projects")
	}

	g := &globals{apps: map[string]*App{}, keys: map[string]*App{}}
	cfg := &Config{Projects: map[string]*Project{}}
	projectsObj, _ := rawProjects.(*jsobj.Object)
	if projectsObj == nil {
		projectsObj = jsobj.New()
	}
	for _, projectID := range projectsObj.Keys() {
		project, _ := projectsObj.Get(projectID)
		at := ""
		if !v1 {
			at = "projects." + projectID
		}
		orProjects := at
		if orProjects == "" {
			orProjects = "projects"
		}
		if !projectIDRE.MatchString(projectID) {
			fail(orProjects, "project IDs are 1–50 lowercase letters, digits, '_' and '-' (got "+projectID+")")
		}
		po, ok := project.(*jsobj.Object)
		if !ok || po == nil {
			fail(orProjects, "must be a mapping")
			continue
		}
		p := parseProject(projectID, po, at, g, fail)
		if _, dup := cfg.Projects[projectID]; !dup {
			cfg.ProjectOrder = append(cfg.ProjectOrder, projectID)
		}
		cfg.Projects[projectID] = p
	}

	if len(problems) > 0 {
		return nil, &Error{Problems: problems}
	}
	document := jsobj.New("version", 2.0, "projects", projectsObj)
	cfg.Document = document
	cfg.Version = jsobj.FNV1a(jsobj.Stringify(document))
	cfg.Apps = g.apps
	cfg.Keys = g.keys
	return cfg, nil
}

func parseProject(projectID string, raw *jsobj.Object, prefix string, g *globals, fail failFunc) *Project {
	path := func(p string) string {
		if prefix != "" {
			return prefix + "." + p
		}
		return p
	}
	allowOnly(raw, projectKeys, prefix, fail)
	name := projectID
	if n, ok := raw.Get("name"); ok {
		s, isStr := n.(string)
		if !isStr || jsobj.Trim(s) == "" || jsobj.UTF16Len(s) > 100 {
			fail(path("name"), "must be a name of 1–100 characters")
		}
	}
	if n, ok := raw.Get("name"); ok {
		if s, isStr := n.(string); isStr && jsobj.Trim(s) != "" {
			name = jsobj.Trim(s)
		}
	}

	// --- apps ---------------------------------------------------------------------------------
	apps := map[string]*App{}
	var appOrder []string
	rawApps, hasApps := raw.Get("apps")
	if hasApps && !jsobj.IsObject(rawApps) {
		fail(path("apps"), "must be a mapping of app IDs to apps")
	}
	appsObj, _ := rawApps.(*jsobj.Object)
	for _, appID := range appsObj.Keys() {
		av, _ := appsObj.Get(appID)
		at := path("apps." + appID)
		if !idRE.MatchString(appID) {
			fail(at, "app IDs may only contain letters, digits, '.', '_', '-' and '$'")
		}
		taken := g.apps[appID]
		if taken != nil {
			fail(at, "app ID "+appID+" is already used in project "+taken.ProjectID+"; app IDs are unique across projects")
		}
		a, ok := av.(*jsobj.Object)
		if !ok || a == nil {
			fail(at, "must be a mapping")
			continue
		}
		allowOnly(a, []string{"store", "bundle_id", "package_name", "sdk_keys", "products", "allow_unverified_purchases", "app_store_server_api", "google_play_api"}, at, fail)
		sv, _ := a.Get("store")
		storeStr, _ := sv.(string)
		store := Store(storeStr)
		if store != AppStore && store != PlayStore {
			fail(at+".store", "must be app_store or play_store")
			continue
		}
		bundleID, bundleOK := nonEmptyString(a, "bundle_id")
		packageName, packageOK := nonEmptyString(a, "package_name")
		if store == AppStore && !bundleOK {
			fail(at+".bundle_id", "required for app_store apps")
		}
		if store == PlayStore && !packageOK {
			fail(at+".package_name", "required for play_store apps")
		}
		// Store notifications identify their app by bundle ID or package name, so each must be unique.
		storeID, storeIDOK := bundleID, bundleOK
		storeField := "bundle_id"
		if store == PlayStore {
			storeID, storeIDOK, storeField = packageName, packageOK, "package_name"
		}
		var twin *App
		if storeIDOK {
			for _, other := range g.appOrder {
				otherID := other.BundleID
				if store == PlayStore {
					otherID = other.PackageName
				}
				if other.Store == store && otherID == storeID {
					twin = other
					break
				}
			}
		}
		if storeIDOK && twin != nil {
			fail(at+"."+storeField, storeID+" is already used by app "+twin.ID)
		}

		auv, _ := a.Get("allow_unverified_purchases")
		app := &App{
			ID:                       appID,
			ProjectID:                projectID,
			Store:                    store,
			Products:                 map[string]*Product{},
			AllowUnverifiedPurchases: auv == true,
		}
		if bundleOK {
			app.BundleID = bundleID
		}
		if packageOK {
			app.PackageName = packageName
		}
		if api, ok := a.Get("app_store_server_api"); ok {
			aat := at + ".app_store_server_api"
			apiObj, isObj := api.(*jsobj.Object)
			if store != AppStore {
				fail(aat, "only app_store apps use the App Store Server API")
			} else if !isObj || apiObj == nil {
				fail(aat, "must be a mapping with issuer_id and key_id")
			} else {
				allowOnly(apiObj, []string{"issuer_id", "key_id", "private_key_secret"}, aat, fail)
				secret := orDefault(apiObj, "private_key_secret", "APPLE_IAP_KEY")
				issuer, issuerOK := nonEmptyString(apiObj, "issuer_id")
				keyID, keyOK := nonEmptyString(apiObj, "key_id")
				if !issuerOK || !issuerIDRE.MatchString(issuer) {
					fail(aat+".issuer_id", "must be the issuer ID (a UUID) from App Store Connect > Users and Access > Integrations")
				}
				if !keyOK || !keyIDRE.MatchString(keyID) {
					fail(aat+".key_id", "must be the 10-character key ID of your In-App Purchase key")
				}
				secretStr, secretIsStr := secret.(string)
				if !secretIsStr || !secretNameRE.MatchString(secretStr) {
					fail(aat+".private_key_secret", "must be a secret name like APPLE_IAP_KEY (capitals, digits, underscores)")
				}
				if issuerOK && keyOK && secretIsStr {
					app.AppStoreServerAPI = &AppStoreServerAPI{IssuerID: issuer, KeyID: keyID, PrivateKeySecret: secretStr}
				}
			}
		}
		if gv, ok := a.Get("google_play_api"); ok {
			gat := at + ".google_play_api"
			gObj, isObj := gv.(*jsobj.Object)
			if store != PlayStore {
				fail(gat, "only play_store apps use the Google Play Developer API")
			} else if !isObj || gObj == nil {
				fail(gat, "must be a mapping with service_account_secret")
			} else {
				allowOnly(gObj, []string{"service_account_secret", "pubsub_push_account", "pubsub_audience"}, gat, fail)
				secret := orDefault(gObj, "service_account_secret", "GOOGLE_SERVICE_ACCOUNT")
				secretStr, secretIsStr := secret.(string)
				if !secretIsStr || !secretNameRE.MatchString(secretStr) {
					fail(gat+".service_account_secret", "must be a Worker secret name like GOOGLE_SERVICE_ACCOUNT (the key itself never goes here)")
				}
				pushV, pushOK := gObj.Get("pubsub_push_account")
				pushStr, pushIsStr := pushV.(string)
				if pushOK && (!pushIsStr || !pushAcctRE.MatchString(pushStr)) {
					fail(gat+".pubsub_push_account", "must be a service account email, like rtdn-push@my-project.iam.gserviceaccount.com")
				}
				audV, audOK := gObj.Get("pubsub_audience")
				audStr, audIsStr := audV.(string)
				if audOK && !audIsStr {
					fail(gat+".pubsub_audience", "must be a string")
				}
				if secretIsStr {
					api := &GooglePlayAPI{ServiceAccountSecret: secretStr}
					if pushIsStr {
						api.PubsubPushAccount = pushStr
					}
					if audIsStr {
						api.PubsubAudience = &audStr
					}
					app.GooglePlayAPI = api
				}
			}
		}
		if auvOK := a.Has("allow_unverified_purchases"); auvOK {
			if _, isBool := auv.(bool); !isBool {
				fail(at+".allow_unverified_purchases", "must be true or false")
			}
		}

		sdkKeys, _ := a.Get("sdk_keys")
		keyList, isList := sdkKeys.([]any)
		if !isList || len(keyList) == 0 {
			fail(at+".sdk_keys", "list at least one public SDK key")
		}
		for i, kv := range keyList {
			kat := fmt.Sprintf("%s.sdk_keys[%d]", at, i)
			key, isStr := kv.(string)
			switch {
			case !isStr || !sdkKeyRE.MatchString(key):
				fail(kat, "must be 16–128 letters, digits or underscores")
			case strings.HasPrefix(key, "test_"):
				// The SDKs switch to RevenueCat's simulated store for test_ keys (spec/sdk-wire-contract.md).
				fail(kat, "must not start with test_: the SDKs treat test_ keys as RevenueCat's simulated store")
			case !strings.HasPrefix(key, keyPrefix[store]):
				fail(kat, string(store)+" keys must start with "+keyPrefix[store])
			case g.keys[key] != nil:
				fail(kat, "already used by app "+g.keys[key].ID)
			default:
				app.SDKKeys = append(app.SDKKeys, key)
				g.keys[key] = app
			}
		}

		// An app may start without products (added from the dashboard); the setup checks flag it.
		pv, hasProducts := a.Get("products")
		if hasProducts && !jsobj.IsObject(pv) {
			fail(at+".products", "must be a mapping of product IDs, e.g. { pro_monthly: { type: subscription } }")
		}
		productsObj, _ := pv.(*jsobj.Object)
		for _, productID := range productsObj.Keys() {
			raw, _ := productsObj.Get(productID)
			pat := at + ".products." + productID
			if !idRE.MatchString(productID) || strings.Contains(productID, ":") {
				fail(pat, "invalid product ID")
			}
			p, ok := raw.(*jsobj.Object)
			if !ok || p == nil {
				fail(pat, "must be a mapping, e.g. { type: subscription }")
				continue
			}
			allowOnly(p, []string{"type", "base_plans", "subscription_group"}, pat, fail)
			typeV, _ := p.Get("type")
			typeStr, _ := typeV.(string)
			sg, hasSG := p.Get("subscription_group")
			if hasSG {
				if store != AppStore || typeV != "subscription" {
					fail(pat+".subscription_group", "only App Store subscriptions have a subscription group")
				} else {
					switch sg.(type) {
					case string, float64:
					default:
						fail(pat+".subscription_group", "must be the subscription group ID from App Store Connect")
					}
				}
			}
			if !slices.Contains(productTypes, typeStr) || typeV == nil {
				fail(pat+".type", "must be one of "+strings.Join(productTypes, ", "))
			}
			bpV, bpOK := p.Get("base_plans")
			if !bpOK || bpV == nil {
				bpV = []any{}
			}
			bpList, bpIsList := bpV.([]any)
			var basePlans []string
			allIDs := bpIsList
			for _, b := range bpList {
				s, ok := b.(string)
				if !ok || !idRE.MatchString(s) {
					allIDs = false
				}
			}
			if !allIDs {
				fail(pat+".base_plans", "must be a list of base plan IDs")
			} else if len(bpList) > 0 && (store != PlayStore || typeV != "subscription") {
				fail(pat+".base_plans", "only Google Play subscriptions have base plans")
			}
			if bpIsList {
				for _, b := range bpList {
					s, _ := b.(string)
					basePlans = append(basePlans, s)
				}
			}
			product := &Product{ID: productID, Type: ProductType(typeStr), BasePlans: basePlans}
			if hasSG {
				product.SubscriptionGroup = jsobj.String(sg, true)
			}
			if _, dup := app.Products[productID]; !dup {
				app.ProductOrder = append(app.ProductOrder, productID)
			}
			app.Products[productID] = product
		}
		if _, dup := apps[appID]; !dup {
			appOrder = append(appOrder, appID)
		}
		apps[appID] = app
		if taken == nil {
			g.apps[appID] = app
			g.appOrder = append(g.appOrder, app)
		}
	}

	// A product reference: "pro" or, for Play subscriptions, "pro:monthly".
	productRef := func(appID string, ref any, at string) (ProductRef, bool) {
		app := apps[appID]
		if app == nil {
			fail(at, "unknown app "+appID)
			return ProductRef{}, false
		}
		s, ok := ref.(string)
		if !ok {
			fail(at, "must be a product ID")
			return ProductRef{}, false
		}
		parts := strings.Split(s, ":")
		productID := parts[0]
		var basePlanID *string
		if len(parts) > 1 {
			bp := parts[1]
			basePlanID = &bp
		}
		product := app.Products[productID]
		if product == nil || len(parts) > 2 {
			fail(at, s+" is not a product of app "+appID)
			return ProductRef{}, false
		}
		if basePlanID != nil {
			if app.Store != PlayStore || product.Type != Subscription {
				fail(at, s+": only Google Play subscriptions have base plans")
				return ProductRef{}, false
			}
			if len(product.BasePlans) > 0 && !slices.Contains(product.BasePlans, *basePlanID) {
				fail(at, s+": base plan "+*basePlanID+" isn't listed in "+productID+".base_plans")
				return ProductRef{}, false
			}
		}
		return ProductRef{ProductID: productID, BasePlanID: basePlanID}, true
	}

	// --- entitlements -------------------------------------------------------------------------
	var entitlements []*Entitlement
	rawEnts, hasEnts := raw.Get("entitlements")
	entsObj, _ := rawEnts.(*jsobj.Object)
	for _, id := range entsObj.Keys() {
		ev, _ := entsObj.Get(id)
		at := path("entitlements." + id)
		if !idRE.MatchString(id) {
			fail(at, "invalid entitlement ID")
		}
		e, ok := ev.(*jsobj.Object)
		if !ok || e == nil {
			fail(at, "must be a mapping")
			continue
		}
		allowOnly(e, []string{"description", "products"}, at, fail)
		desc, _ := e.Get("description")
		descStr, _ := desc.(string)
		ent := &Entitlement{ID: id, Description: descStr, Products: map[string][]ProductRef{}}
		prodV, _ := e.Get("products")
		prodObj, prodIsObj := prodV.(*jsobj.Object)
		for _, appID := range prodObj.Keys() {
			refsV, _ := prodObj.Get(appID)
			refs, isList := refsV.([]any)
			if !isList {
				fail(at+".products."+appID, "must be a list of product IDs")
				continue
			}
			resolved := []ProductRef{}
			for i, r := range refs {
				if ref, ok := productRef(appID, r, fmt.Sprintf("%s.products.%s[%d]", at, appID, i)); ok {
					resolved = append(resolved, ref)
				}
			}
			ent.Products[appID] = resolved
		}
		if !prodIsObj || prodObj == nil {
			fail(at+".products", "map each app to the products that grant this entitlement")
		}
		entitlements = append(entitlements, ent)
	}
	if hasEnts && !jsobj.IsObject(rawEnts) {
		fail(path("entitlements"), "must be a mapping")
	}

	// --- offerings ----------------------------------------------------------------------------
	var offerings []*Offering
	var currentOffering *string
	rawOfferings, ok := raw.Get("offerings")
	if !ok || rawOfferings == nil {
		rawOfferings = []any{}
	}
	offeringList, isList := rawOfferings.([]any)
	if !isList {
		fail(path("offerings"), "must be a list")
	}
	for i, ov := range offeringList {
		at := path(fmt.Sprintf("offerings[%d]", i))
		o, ok := ov.(*jsobj.Object)
		if !ok || o == nil {
			fail(at, "must be a mapping")
			continue
		}
		allowOnly(o, []string{"id", "current", "description", "metadata", "packages"}, at, fail)
		idV, idOK := o.Get("id")
		idStr, idIsStr := idV.(string)
		if !idIsStr || !idRE.MatchString(idStr) {
			fail(at+".id", "required")
		}
		if idIsStr && slices.ContainsFunc(offerings, func(x *Offering) bool { return x.ID == idStr }) {
			fail(at+".id", "duplicate offering "+idStr)
		}
		offeringID := jsobj.String(idV, idOK)
		if cur, _ := o.Get("current"); cur == true {
			if currentOffering != nil {
				fail(at+".current", "only one offering can be current (already "+*currentOffering+")")
			}
			c := offeringID
			currentOffering = &c
		}
		md, mdOK := o.Get("metadata")
		if mdOK && !jsobj.IsObject(md) {
			fail(at+".metadata", "must be a mapping")
		}
		descV, _ := o.Get("description")
		desc, _ := descV.(string)
		metadata, _ := md.(*jsobj.Object)
		if metadata == nil {
			metadata = jsobj.New()
		}
		offering := &Offering{ID: offeringID, Description: desc, Metadata: metadata}
		pkgsV, _ := o.Get("packages")
		pkgs, pkgsIsList := pkgsV.([]any)
		if !pkgsIsList || len(pkgs) == 0 {
			fail(at+".packages", "list at least one package")
		}
		for j, pv := range pkgs {
			pat := fmt.Sprintf("%s.packages[%d]", at, j)
			p, ok := pv.(*jsobj.Object)
			var pid string
			if ok && p != nil {
				v, _ := p.Get("id")
				pid, _ = v.(string)
			}
			if !ok || p == nil || !idRE.MatchString(pid) {
				fail(pat, "needs an id, e.g. $rc_monthly")
				continue
			}
			if slices.ContainsFunc(offering.Packages, func(x *Package) bool { return x.ID == pid }) {
				fail(pat+".id", "duplicate package "+pid)
			}
			pkg := &Package{ID: pid, Products: map[string]ProductRef{}}
			for _, appID := range p.Keys() {
				if appID == "id" {
					continue
				}
				refV, _ := p.Get(appID)
				if ref, ok := productRef(appID, refV, pat+"."+appID); ok {
					pkg.Products[appID] = ref
				}
			}
			offering.Packages = append(offering.Packages, pkg)
		}
		offerings = append(offerings, offering)
	}
	if len(offerings) > 0 && currentOffering == nil {
		fail(path("offerings"), "mark one offering as current: true")
	}

	// --- webhooks -----------------------------------------------------------------------------
	var webhooks []*Webhook
	rawWebhooks, ok := raw.Get("webhooks")
	if !ok || rawWebhooks == nil {
		rawWebhooks = []any{}
	}
	webhookList, isList := rawWebhooks.([]any)
	if !isList {
		fail(path("webhooks"), "must be a list")
	}
	for i, wv := range webhookList {
		at := path(fmt.Sprintf("webhooks[%d]", i))
		w, ok := wv.(*jsobj.Object)
		if !ok || w == nil {
			fail(at, "must be a mapping with id and url")
			continue
		}
		allowOnly(w, []string{"id", "url", "authorization_secret", "signing_secret", "environments", "events"}, at, fail)
		idV, idOK := w.Get("id")
		idStr, idIsStr := idV.(string)
		if !idIsStr || !idRE.MatchString(idStr) {
			fail(at+".id", "required, e.g. backend")
		} else if slices.ContainsFunc(webhooks, func(x *Webhook) bool { return x.ID == idStr }) {
			fail(at+".id", "duplicate webhook "+idStr)
		}
		urlV, urlOK := w.Get("url")
		urlStr := jsobj.String(urlV, urlOK)
		u, valid := parseFullURL(urlStr)
		if !valid {
			fail(at+".url", "must be a full URL")
		}
		if valid && u.Scheme != "https" && !(u.Scheme == "http" && (strings.ToLower(u.Hostname()) == "localhost" || u.Hostname() == "127.0.0.1")) {
			fail(at+".url", "must use https (http is allowed only for localhost)")
		}
		secretName := func(key string) string {
			v, ok := w.Get(key)
			if !ok {
				return ""
			}
			s, isStr := v.(string)
			if !isStr || !secretNameRE.MatchString(s) {
				fail(at+"."+key, "must be a Worker secret name like WEBHOOK_SIGNING_SECRET (the secret itself never goes here)")
				return ""
			}
			return s
		}
		envsV, envsOK := w.Get("environments")
		if !envsOK || envsV == nil {
			envsV = []any{"production", "sandbox"}
		}
		envList, envIsList := envsV.([]any)
		envsValid := envIsList && len(envList) > 0
		var envs []string
		for _, e := range envList {
			s, _ := e.(string)
			if s != "production" && s != "sandbox" {
				envsValid = false
			}
			envs = append(envs, s)
		}
		if !envsValid {
			fail(at+".environments", "must list production and/or sandbox")
		}
		var events map[string]bool
		if evV, ok := w.Get("events"); ok {
			evList, evIsList := evV.([]any)
			if !evIsList || len(evList) == 0 {
				fail(at+".events", "must be a list of event types")
			} else {
				events = map[string]bool{}
				for _, e := range evList {
					s, isStr := e.(string)
					if !isStr || !slices.Contains(WebhookEventTypes, s) {
						fail(at+".events", "unknown event type "+jsobj.String(e, true))
					}
					if isStr {
						events[s] = true
					}
				}
			}
		}
		webhook := &Webhook{
			ID:                  jsobj.String(idV, idOK),
			URL:                 urlStr,
			AuthorizationSecret: secretName("authorization_secret"),
			SigningSecret:       secretName("signing_secret"),
			Events:              events,
		}
		if envIsList {
			webhook.Environments = envs
		} else {
			webhook.Environments = []string{}
		}
		webhooks = append(webhooks, webhook)
	}

	return &Project{
		ID:              projectID,
		Name:            name,
		Version:         jsobj.FNV1a(jsobj.Stringify(raw)),
		Apps:            apps,
		AppOrder:        appOrder,
		Entitlements:    entitlements,
		Offerings:       offerings,
		CurrentOffering: currentOffering,
		Webhooks:        webhooks,
	}
}

// parseFullURL approximates `new URL(s)` succeeding: an absolute URL, with a host for http(s).
func parseFullURL(s string) (*url.URL, bool) {
	u, err := url.Parse(s)
	if err != nil || u.Scheme == "" {
		return nil, false
	}
	switch u.Scheme {
	case "http", "https", "ws", "wss", "ftp":
		if u.Host == "" {
			return nil, false
		}
	}
	return u, true
}

func nonEmptyString(o *jsobj.Object, key string) (string, bool) {
	v, _ := o.Get(key)
	s, ok := v.(string)
	return s, ok && s != ""
}

// orDefault is JavaScript's `o[key] ?? def`.
func orDefault(o *jsobj.Object, key string, def any) any {
	v, ok := o.Get(key)
	if !ok || v == nil {
		return def
	}
	return v
}

func allowOnly(o *jsobj.Object, allowed []string, at string, fail failFunc) {
	for _, k := range o.Keys() {
		if !slices.Contains(allowed, k) {
			p := k
			if at != "" {
				p = at + "." + k
			}
			fail(p, "unknown key (expected one of: "+strings.Join(allowed, ", ")+")")
		}
	}
}

// --- lookups --------------------------------------------------------------------------------

// EntitlementsFor returns the entitlement IDs granted by a purchase of productID (and base plan)
// in an app. basePlanID nil means no base plan.
func (p *Project) EntitlementsFor(appID, productID string, basePlanID *string) []string {
	var out []string
	for _, e := range p.Entitlements {
		for _, r := range e.Products[appID] {
			if r.ProductID == productID && (r.BasePlanID == nil || (basePlanID != nil && *r.BasePlanID == *basePlanID)) {
				out = append(out, e.ID)
				break
			}
		}
	}
	return out
}

// HasEntitlement reports whether the project defines an entitlement.
func (p *Project) HasEntitlement(id string) bool {
	return slices.ContainsFunc(p.Entitlements, func(e *Entitlement) bool { return e.ID == id })
}

// ProjectOfApp returns the project an app belongs to.
func (c *Config) ProjectOfApp(appID string) *Project {
	app := c.Apps[appID]
	if app == nil {
		return nil
	}
	return c.Projects[app.ProjectID]
}
