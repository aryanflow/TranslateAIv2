import {
  preserveUiCatalogMarks,
  repairLeadingWin32Ampersand,
  repairLatinStrSchemaToken,
} from './preserve-ui-catalog-marks';

describe('repairLeadingWin32Ampersand', () => {
  it('prepends when source has leading mnemonic and translation dropped it', () => {
    expect(repairLeadingWin32Ampersand('&Current columns', 'वर्तमान कॉलम')).toBe(
      '&वर्तमान कॉलम',
    );
  });

  it('does not prepend when translation already has leading &', () => {
    expect(repairLeadingWin32Ampersand('&About', '&के बारे में')).toBe('&के बारे में');
  });

  it('does not prepend for middle mnemonic (M&ay)', () => {
    expect(repairLeadingWin32Ampersand('M&ay be later', 'बाद में')).toBe('बाद में');
  });

  it('does not prepend when source starts with escaped &&', () => {
    expect(repairLeadingWin32Ampersand('&&Literal', 'लिटरल')).toBe('लिटरल');
  });
});

describe('repairLatinStrSchemaToken', () => {
  it('replaces Hindi स्ट्र with Latin Str when English had Str', () => {
    expect(
      repairLatinStrSchemaToken(
        'Originating Str Fe Resource ID',
        'उत्पत्ति स्ट्र Fe संसाधन ID',
      ),
    ).toBe('उत्पत्ति Str Fe संसाधन ID');
  });

  it('leaves translation unchanged when source has no Str word', () => {
    expect(repairLatinStrSchemaToken('Store', 'स्टोर')).toBe('स्टोर');
  });
});

describe('preserveUiCatalogMarks', () => {
  it('applies Str repair then leading &', () => {
    expect(
      preserveUiCatalogMarks(
        '&Originating Str Fe Resource ID',
        'उत्पत्ति स्ट्र Fe संसाधन ID',
      ),
    ).toBe('&उत्पत्ति Str Fe संसाधन ID');
  });
});
