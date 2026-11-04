import { Account, Address, CHAIN_ID, OperationManager, OperationType } from '@massalabs/massa-web3';
import {
  KNOWN_CHAIN_IDS,
  carriesPublicKey,
  isRefusedMessage,
  startsWithChainId,
} from './sign-guard';

const RECIPIENT = Address.fromString('AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz');

/** The bytes a node checks a transfer's signature against: what an attacker would ask to sign. */
function transferPreimage(chainId: bigint, account: Account): Uint8Array {
  return OperationManager.canonicalize(
    chainId,
    {
      type: OperationType.Transaction,
      fee: 10_000_000n,
      expirePeriod: 123_456,
      recipientAddress: RECIPIENT,
      amount: 1_000_000_000_000n,
    },
    account.publicKey,
  );
}

describe('sign guard', () => {
  it("knows massa-web3's chain ids", () => {
    expect(KNOWN_CHAIN_IDS).toEqual([CHAIN_ID.Mainnet, CHAIN_ID.Buildnet]);
  });

  it('the attack it stops is real: a message signature IS a transfer signature', async () => {
    const account = await Account.generate();
    const message = transferPreimage(CHAIN_ID.Mainnet, account);
    const asMessage = await account.sign(message);
    const asTransfer = await new OperationManager(account.privateKey).sign(CHAIN_ID.Mainnet, {
      type: OperationType.Transaction,
      fee: 10_000_000n,
      expirePeriod: 123_456,
      recipientAddress: RECIPIENT,
      amount: 1_000_000_000_000n,
    });
    expect(asMessage.toString()).toBe(asTransfer.toString());
  });

  it('refuses operations on mainnet and buildnet, for any account', async () => {
    const signer = await Account.generate();
    const other = await Account.generate();
    for (const chainId of [CHAIN_ID.Mainnet, CHAIN_ID.Buildnet]) {
      expect(startsWithChainId(transferPreimage(chainId, other))).toBe(true);
      expect(isRefusedMessage(transferPreimage(chainId, signer), signer.publicKey.toBytes())).toBe(
        true,
      );
    }
  });

  it("refuses the signer's operations on any other chain id too", async () => {
    const signer = await Account.generate();
    const data = transferPreimage(424242n, signer);
    expect(startsWithChainId(data)).toBe(false);
    expect(carriesPublicKey(data, signer.publicKey.toBytes())).toBe(true);
    expect(isRefusedMessage(data, signer.publicKey.toBytes())).toBe(true);
  });

  it('signs ordinary messages', async () => {
    const signer = await Account.generate();
    const key = signer.publicKey.toBytes();
    for (const text of ['hello', 'Sign in to dusa.io\nNonce: 8f2a91', '{"login":"AU12…"}', 'x']) {
      expect(isRefusedMessage(new TextEncoder().encode(text), key), text).toBe(false);
    }
    expect(isRefusedMessage(new Uint8Array(200), key)).toBe(false);
  });
});
