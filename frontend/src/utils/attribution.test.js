import { describe, it, expect } from 'vitest';
import { getAttributionSuffix, appendAttribution } from './attribution';

describe('ERC-8021 Transaction Attribution Suffix', () => {
  describe('getAttributionSuffix', () => {
    it('should return 0x for empty tag', () => {
      expect(getAttributionSuffix('')).toBe('0x');
    });

    it('should generate a correct suffix for a given tag', () => {
      const tag = 'morelucks';
      const suffix = getAttributionSuffix(tag);

      // Suffix format:
      // tag in hex: 'morelucks' -> '6d6f72656c75636b73'
      // length in 1 byte: 9 -> '09'
      // schema ID: '00'
      // marker: '80218021802180218021802180218021'
      const expected = '0x6d6f72656c75636b73090080218021802180218021802180218021';
      expect(suffix).toBe(expected);
    });

    it('should end with the 16-byte ERC-8021 marker', () => {
      const suffix = getAttributionSuffix('test');
      expect(suffix.endsWith('80218021802180218021802180218021')).toBe(true);
    });

    it('should have the correct schema ID of 00 before the marker', () => {
      const suffix = getAttributionSuffix('test');
      // The suffix ends with schema ID (2 chars) + marker (32 chars) = 34 chars
      const markerAndSchema = suffix.slice(-34);
      expect(markerAndSchema.startsWith('00')).toBe(true);
    });

    it('should have the correct code length byte before the schema ID', () => {
      const tag = 'abc'; // 3 bytes
      const suffix = getAttributionSuffix(tag);
      // Suffix ends with length (2 chars) + schema ID (2 chars) + marker (32 chars) = 36 chars
      const last36 = suffix.slice(-36);
      expect(last36.startsWith('03')).toBe(true);
    });

    it('should calculate correct lengths for tags of different sizes', () => {
      const tagShort = 'a';
      const suffixShort = getAttributionSuffix(tagShort);
      expect(suffixShort.slice(-36, -34)).toBe('01');

      const tagLong = 'longerbuildername'; // 17 characters
      const suffixLong = getAttributionSuffix(tagLong);
      // 17 in hex is '11'
      expect(suffixLong.slice(-36, -34)).toBe('11');
    });
  });

  describe('appendAttribution', () => {
    it('should return original data if tag is empty', () => {
      expect(appendAttribution('0x1234', '')).toBe('0x1234');
      expect(appendAttribution('1234', '')).toBe('0x1234');
    });

    it('should append suffix to dummy tx data starting with 0x', () => {
      const txData = '0x112233';
      const tag = 'test';
      const result = appendAttribution(txData, tag);

      const expectedSuffix = getAttributionSuffix(tag).slice(2);
      expect(result).toBe('0x112233' + expectedSuffix);
    });

    it('should append suffix to dummy tx data without 0x prefix', () => {
      const txData = '112233';
      const tag = 'test';
      const result = appendAttribution(txData, tag);

      const expectedSuffix = getAttributionSuffix(tag).slice(2);
      expect(result).toBe('0x112233' + expectedSuffix);
    });
  });
});
