import { describe, expect, it } from 'vitest';
import { sniffImageType } from './session';
import { newSecret, parseJoinHash } from './shareManager';

describe('받은 이미지 형식 판별', () => {
  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0], 'image/png'],
    [[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0], 'image/jpeg'],
    [[0x47, 0x49, 0x46, 0x38, 0, 0, 0, 0, 0, 0], 'image/gif'],
    [[0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45], 'image/webp'],
    [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'application/octet-stream'],
  ])('%j → %s', (bytes, type) => expect(sniffImageType(new Uint8Array(bytes))).toBe(type));
});

const ID = '3f2b8c1e-9a4d-4e7f-8b21-0c5d6e7f8a9b';

describe('공유 링크', () => {
  it('비밀값은 링크에 안전한 문자만, 충분한 길이', () => {
    const s = newSecret();
    expect(s).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(newSecret()).not.toBe(s);
  });

  it('올바른 해시를 해석한다', () => {
    const secret = newSecret();
    expect(parseJoinHash(`#join=${ID}.${secret}`)).toEqual({ mapId: ID, secret });
  });

  it.each(['', '#join=', `#join=${ID}`, `#join=not-a-uuid.${'a'.repeat(24)}`, `#join=${ID}.short`, `#join=${ID}.${'a'.repeat(20)}<script>`])(
    '잘못된 해시는 거부: %s',
    (h) => expect(parseJoinHash(h)).toBeNull(),
  );
});
