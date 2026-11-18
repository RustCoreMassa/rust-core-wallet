import manifest from './manifest.json';

/*
 * Firefox's built-in data consent (Mozilla Add-ons policy). Anything the add-on sends outside the
 * browser counts, wherever it goes: the wallet sends the user's transactions to Massa's nodes and
 * reads balances and history (payment history) from them and the indexer — financial and payment
 * information. Declaring "none" got 1.7.2 disabled on AMO ("Data collected mismatch").
 */
const gecko = manifest.browser_specific_settings.gecko;

describe('Firefox data collection declaration', () => {
  it('declares the financial data the wallet cannot work without', () => {
    // Required, not optional: without the network there is no balance and no transaction.
    expect(gecko.data_collection_permissions.required).toEqual(['financialAndPaymentInfo']);
  });

  it('targets the Firefox versions that show the consent at install', () => {
    // Built-in consent exists from Firefox 140 (desktop) and 142 (Android); older versions would
    // install the wallet without asking.
    expect(gecko.strict_min_version).toBe('140.0');
    expect(manifest.browser_specific_settings.gecko_android.strict_min_version).toBe('142.0');
  });
});
