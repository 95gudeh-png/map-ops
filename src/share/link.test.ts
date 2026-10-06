import { describe, expect, it } from 'vitest';
import { sniffImageType } from './session';
import { newSecret, parseSessionHash, PUBLIC_APP_URL, sessionLink } from './shareManager';

const ID = '3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b';

describe('세션 링크 주소', () => {
  const S = 'a'.repeat(24);
  it('localhost에서 만들면 공개 사이트 주소로', () => {
    for (const hostname of ['localhost', '127.0.0.1', 'b.localhost']) {
      const link = sessionLink(ID, S, { origin: `http://${hostname}:5173`, pathname: '/', hostname });
      expect(link).toBe(`${PUBLIC_APP_URL}#session=${ID}.${S}`);
    }
  });
  it('공개 사이트에서는 그 주소 그대로', () => {
    const link = sessionLink(ID, S, { origin: 'https://95gudeh-png.github.io', pathname: '/map-ops/', hostname: '95gudeh-png.github.io' });
    expect(link).toBe(`https://95gudeh-png.github.io/map-ops/#session=${ID}.${S}`);
  });
});

describe('받은 이미지 형식 판별', () => {
  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0], 'image/png'],
    [[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0], 'image/jpeg'],
    [[0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0], 'image/gif'],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45], 'image/webp'],
    [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'application/octet-stream'],
  ])('%j → %s', (bytes, type) => expect(sniffImageType(new Uint8Array(bytes))).toBe(type));
});

describe('세션 링크 해석', () => {
  it('비밀값은 링크에 안전한 문자만, 충분한 길이', () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(newSecret()).not.toBe(s);
  });

  it('올바른 해시를 해석한다', () => {
    const secret = newSecret();
    expect(parseSessionHash(`#session=${ID}.${secret}`)).toEqual({ id: ID, secret });
  });

  it.each([
    '',
    '#session=',
    `#session=${ID}`,
    `#session=not-a-uuid.${'a'.repeat(24)}`,
    `#session=${ID}.short`,
    `#session=${ID}.${'a'.repeat(20)}<script>`,
    `#join=${ID}.${'a'.repeat(24)}`, // 예전 맵별 링크 형식은 받지 않는다
  ])('잘못된 해시는 거부: %s', (h) => expect(parseSessionHash(h)).toBeNull());
});
