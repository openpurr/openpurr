# The Standard edition server as a static binary on distroless. Build from this directory:
#   docker build -t openpurr-standard .
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/openpurr ./cmd/openpurr

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/openpurr /openpurr
ENV PORT=8080
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/openpurr"]
