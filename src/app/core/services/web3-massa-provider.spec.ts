import { TestBed } from '@angular/core/testing';
import { Account, Address, CHAIN_ID, OperationManager, OperationType } from '@massalabs/massa-web3';
import { RefusedSignError } from '../utils/sign-guard';
import { Web3MassaProvider } from './web3-massa-provider';

describe('Web3MassaProvider.signMessage', () => {
  let provider: Web3MassaProvider;
  let account: Account;

  beforeEach(async () => {
    provider = TestBed.inject(Web3MassaProvider);
    account = await Account.generate();
  });

  it('signs an ordinary message, as massa-web3 does', async () => {
    const data = new TextEncoder().encode('Sign in to example.com');
    const signed = await provider.signMessage(account.privateKey.toString(), data);
    expect(signed.publicKey).toBe(account.publicKey.toString());
    expect(signed.signature).toBe((await account.sign(data)).toString());
  });

  it("never signs a transfer's bytes, whatever the chain id", async () => {
    for (const chainId of [CHAIN_ID.Mainnet, CHAIN_ID.Buildnet, 9n]) {
      const preimage = OperationManager.canonicalize(
        chainId,
        {
          type: OperationType.Transaction,
          fee: 10_000_000n,
          expirePeriod: 1,
          recipientAddress: Address.fromString(
            'AU12K8ag8RQEBhFLtT6ixoMvv4ZsG2DNzKq3tbB1vssWM3LMZYskz',
          ),
          amount: 1n,
        },
        account.publicKey,
      );
      await expect(
        provider.signMessage(account.privateKey.toString(), preimage),
      ).rejects.toBeInstanceOf(RefusedSignError);
    }
  });
});
