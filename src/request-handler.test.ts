import {
    assertEquals,
    assertSpyCallArg,
    assertSpyCalls,
    returnsNext,
    stub,
} from '../dev_deps.ts';
import { dotenvLoad } from '../deps.ts';

import { _internals } from './utils.ts';
import { requestHandler } from './request-handler.ts';

dotenvLoad({ export: true });

const UPSTREAM_ORIGIN = Deno.env.get('UPSTREAM_ORIGIN') as string;
const SELF_ORIGIN = 'https://registry.test';

// Disable cache for tests
Deno.env.set('CACHE', 'false');

const fetchReturn = (
    body = `{"name":"ms"}`,
) => (
    Promise.resolve(
        new Response(body, {
            headers: new Headers({
                'access-control-allow-origin': '*',
                'access-control-allow-methods': 'GET',
            }),
        }),
    )
);

Deno.test('requestHandler', async (t) => {
    await t.step(
        'should forward the request to $UPSTREAM_ORIGIN keeping the parameters',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            const req = new Request(`${SELF_ORIGIN}/ms`);
            await requestHandler(req);
            assertSpyCallArg(fetchStub, 0, 0, `${UPSTREAM_ORIGIN}/ms`);
            fetchStub.restore();
        },
    );

    await t.step(
        'should handle $UPSTREAM_ORIGIN with ending slash',
        async () => {
            Deno.env.set('UPSTREAM_ORIGIN', 'https://registry.npmjs.org/');
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            const req = new Request(`${SELF_ORIGIN}/ms`);
            await requestHandler(req);
            assertSpyCallArg(fetchStub, 0, 0, `https://registry.npmjs.org/ms`);
            fetchStub.restore();
            Deno.env.set('UPSTREAM_ORIGIN', UPSTREAM_ORIGIN);
        },
    );

    await t.step(
        'should forward the request to $UPSTREAM_ORIGIN adding the UPSTREAM_AUTH_TOKEN if present',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            Deno.env.set('UPSTREAM_AUTH_TOKEN', '1234');
            const req = new Request(`${SELF_ORIGIN}/ms`);
            await requestHandler(req);
            const spyCall = fetchStub.calls[0];
            const secondArg = spyCall && spyCall.args[1];
            const headers = secondArg?.headers as Headers;
            assertEquals(headers.get('authorization'), 'Bearer 1234');
            fetchStub.restore();
            Deno.env.set('UPSTREAM_AUTH_TOKEN', '');
        },
    );

    await t.step(
        'should respond with 401 code and not forward the request to $UPSTREAM_ORIGIN if AUTH_TOKEN is required by config and not present in the request',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            Deno.env.set('AUTH_TOKEN', 'abcd');
            const req = new Request(`${SELF_ORIGIN}/ms`);
            const res = await requestHandler(req);
            assertEquals(res.status, 401);
            assertSpyCalls(fetchStub, 0);
            fetchStub.restore();
            Deno.env.set('AUTH_TOKEN', '');
        },
    );

    await t.step(
        'should forward the request to $UPSTREAM_ORIGIN if AUTH_TOKEN is required by config and present in the request',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            Deno.env.set('AUTH_TOKEN', 'abcd');
            const req = new Request(`${SELF_ORIGIN}/ms`, {
                headers: { authorization: 'Bearer abcd' },
            });
            const res = await requestHandler(req);
            assertEquals(res.status !== 401, true);
            assertSpyCalls(fetchStub, 1);
            fetchStub.restore();
            Deno.env.set('AUTH_TOKEN', '');
        },
    );

    await t.step(
        'should forward the request to $UPSTREAM_ORIGIN removing the $basePath',
        async () => {
            Deno.env.set('BASE_PATH', '/sub-dir');
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            const req = new Request(`${SELF_ORIGIN}/sub-dir/ms`);
            await requestHandler(req);
            assertSpyCallArg(fetchStub, 0, 0, `${UPSTREAM_ORIGIN}/ms`);
            fetchStub.restore();
            Deno.env.set('BASE_PATH', '');
        },
    );

    await t.step(
        'should forward the request to $UPSTREAM_ORIGIN taking into account that `X-Real-Origin` and the current request URL may differ in origin',
        async () => {
            Deno.env.set('BASE_PATH', '/sub-dir');
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            const req = new Request(`${SELF_ORIGIN}/sub-dir/ms`, {
                headers: { 'X-Real-Origin': 'https://registry.another/' },
            });
            await requestHandler(req);
            assertSpyCallArg(fetchStub, 0, 0, `${UPSTREAM_ORIGIN}/ms`);
            fetchStub.restore();
            Deno.env.set('BASE_PATH', '');
        },
    );

    await t.step(
        'should forward the upstream response CORS headers back to the client',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([fetchReturn()]),
            );
            const req = new Request(`${SELF_ORIGIN}/ms`);
            const res = await requestHandler(req);
            assertEquals(
                res.headers.get('access-control-allow-methods'),
                'GET',
            );
            fetchStub.restore();
        },
    );

    await t.step(
        'should return a redirect reponse with the replaced "Location:" header when UPSTREAM_ORIGIN responds with >= 300 < 400 status',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([
                    Promise.resolve(
                        new Response('', {
                            status: 302,
                            headers: {
                                'Location': `${UPSTREAM_ORIGIN}/ms@2.1.3`,
                            },
                        }),
                    ),
                ]),
            );
            const req = new Request(`${SELF_ORIGIN}/ms`);
            const res = await requestHandler(req);
            assertEquals(res.status, 302);
            assertEquals(
                res.headers.get('location'),
                `${SELF_ORIGIN}/ms@2.1.3`,
            );
            assertSpyCalls(fetchStub, 1);
            fetchStub.restore();
        },
    );

    await t.step(
        'should return a redirect reponse with the replaced "Location:" header when UPSTREAM_ORIGIN responds taking into account BASE_PATH and X-Real-Origin',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([
                    Promise.resolve(
                        new Response('', {
                            status: 302,
                            headers: {
                                'Location': `${UPSTREAM_ORIGIN}/ms@2.1.3`,
                            },
                        }),
                    ),
                ]),
            );
            Deno.env.set('BASE_PATH', '/sub-dir');
            const realOrigin = 'https://public.proxy.com';
            const req = new Request(`${SELF_ORIGIN}/ms`, {
                headers: { 'X-Real-Origin': realOrigin },
            });
            const res = await requestHandler(req);
            assertEquals(res.status, 302);
            assertEquals(
                res.headers.get('location'),
                `${realOrigin}/sub-dir/ms@2.1.3`,
            );
            assertSpyCalls(fetchStub, 1);
            fetchStub.restore();
            Deno.env.set('BASE_PATH', '');
        },
    );

    await t.step(
        'should return the original reponse "as-is" when UPSTREAM_ORIGIN responds with a !ok status other than >= 300 < 400',
        async () => {
            const fetchStub = stub(
                _internals,
                'fetch',
                returnsNext([
                    Promise.resolve(new Response('', { status: 404 })),
                ]),
            );
            const req = new Request(`${SELF_ORIGIN}/ms`);
            const res = await requestHandler(req);
            assertEquals(res.status, 404);
            assertSpyCalls(fetchStub, 1);
            fetchStub.restore();
        },
    );
});
