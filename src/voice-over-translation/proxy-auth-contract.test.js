import assert from 'node:assert/strict';
import test from 'node:test';
import { VOTJSError } from '@vot.js/core/client';
import { BaseProvider } from '@vot.js/core/providers/base';

import {
  isVotProxyAuthInvalidError,
  VOT_PROXY_AUTH_INVALID_CODE,
  VOTProxyAuthInvalidError
} from './proxy-auth-contract.js';

test('auth-invalid contract recognizes only its typed or wrapped machine code', () => {
  assert.equal(
    isVotProxyAuthInvalidError(new VOTProxyAuthInvalidError()),
    true
  );
  assert.equal(
    isVotProxyAuthInvalidError({
      data: { success: false, data: VOT_PROXY_AUTH_INVALID_CODE }
    }),
    true
  );
  assert.equal(
    isVotProxyAuthInvalidError(new Error('auth required: token expired')),
    false
  );
  assert.equal(
    isVotProxyAuthInvalidError({
      data: { success: false, data: 'auth required: token expired' }
    }),
    false
  );
});

test('@vot.js/core preserves the auth-invalid machine code in its error envelope', async () => {
  const provider = new BaseProvider({
    fetchFn: async () => {
      throw new VOTProxyAuthInvalidError();
    }
  });
  const providerResult = await provider.request(
    '/video-translation/translate',
    new Uint8Array()
  );
  const wrapped = new VOTJSError(
    'Failed to request video translation',
    providerResult
  );

  assert.deepEqual(providerResult, {
    success: false,
    data: VOT_PROXY_AUTH_INVALID_CODE
  });
  assert.equal(isVotProxyAuthInvalidError(wrapped), true);
});
