# Bearer proxy

[![codecov](https://codecov.io/gh/esroyo/bearer-proxy/graph/badge.svg?token=RQF8CF8VUV)](https://codecov.io/gh/esroyo/bearer-proxy)

Simple proxy to forward requests to an upstream HTTP server adding a Bearer authentication (also called token authentication).

## ENV variables

* `UPSTREAM_AUTH_TOKEN`: the upstream token to include in the "Authorization" header.
* `UPSTREAM_ORIGIN`: the [URL origin](https://developer.mozilla.org/en-US/docs/Web/API/URL/origin) of the upstream HTTP service
* `AUTH_TOKEN`: a token to secure the requests to this proxy (optional)
* `BASE_PATH`: an optional path if this service need to run on a folder (for instance "http://planet.earth/bearer-proxy/")
* `CACHE`: enable on-disk cache of the upstream responses (defaults to use cache-control `max-age` value as TTL)

## Local environment

```sh
# build a docker image of this service
docker build -t bearer-proxy .

# run the service on localhost:8000
docker run -p 8000:8000 bearer-proxy
```

## Example instance

https://npm-registry-proxy.deno.dev/ms
