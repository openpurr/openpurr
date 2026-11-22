# The Standard edition server as a static binary on distroless, with the dashboard (lite/office-ui)
# embedded. Build from the repository root, so the dashboard's files are in the context:
#   docker build -f standard/Dockerfile -t openpurr-standard .
FROM golang:1.26 AS build
WORKDIR /src/standard
COPY standard/go.mod standard/go.sum ./
RUN go mod download
COPY standard/ ./
COPY lite/office-ui/ ./internal/officeui/files/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/openpurr ./cmd/openpurr

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/openpurr /openpurr
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/openpurr"]
