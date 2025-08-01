/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable no-empty-pattern */
import { OfflineAminoSigner, Secp256k1HdWallet, Secp256k1Wallet, StdSignDoc } from '@cosmjs/amino';
import { toString } from 'uint8arrays/to-string';
import { sha256 } from '@cosmjs/crypto';
import { LitNodeClientNodeJs, LitNodeClient } from '@lit-protocol/lit-node-client';
import { LitContracts as LitContractsClient } from '@lit-protocol/contracts-sdk';
import {
	AccsCOSMOSParams,
	ConditionType,
	DecryptResponse,
	EncryptResponse,
	LitAbility,
	MintCapacityCreditsRes,
	UnifiedAccessControlConditions,
	AuthSig as GenericAuthSig,
	SignerLike,
} from '@lit-protocol/types';
import { generateSymmetricKey, randomBytes } from './utils/helpers';
import { isBrowser, isNode } from './utils/env';
import { v4 } from 'uuid';
import { fromString } from 'uint8arrays';
import { LitProtocolDebugEnabled } from './utils/constants';
import { LitAccessControlConditionResource, LitActionResource, LitPKPResource } from '@lit-protocol/auth-helpers';
import { ethers } from 'ethers';
import { AuthMethodScope, AuthMethodType, LIT_RPC } from '@lit-protocol/constants';
import { initWasmBlsSdk } from '@lit-protocol/bls-sdk';
import { litActionCode } from './litactions';
import ipfsOnlyHash from "typestub-ipfs-only-hash";

export type ThresholdEncryptionResult = {
	encryptedString: Uint8Array;
	stringHash: string;
};
export type SymmetricEncryptionResult = {
	encryptedString: Blob;
	stringHash: string;
	symmetricKey: Uint8Array;
};
export type AuthSignature = {
	sig: string;
	derivedVia: 'cosmos.signArbitrary';
	signedMessage: string;
	address: string;
    algo: string;
    pubKey: string;
};
export type CosmosAuthSignature = {
	cosmos: AuthSignature;
};
export type CosmosAccessControlCondition = AccsCOSMOSParams & {
	conditionType: ConditionType;
};
export type CosmosReturnValueTest = CosmosAccessControlCondition['returnValueTest'];
export type SaveEncryptionKeyArgs = {
	unifiedAccessControlConditions: CosmosAccessControlCondition[];
	symmetricKey: CryptoKey;
	authSig: CosmosAuthSignature;
	chain: string;
};
export type GetEncryptionKeyArgs = {
	unifiedAccessControlConditions: CosmosAccessControlCondition[];
	toDecrypt: string;
	authSig: CosmosAuthSignature;
	chain: string;
};
export type EncryptStringMethodResult = EncryptResponse;
export type DecryptToStringMethodResult = DecryptResponse;
export type EncryptStringMethod = (str: string) => Promise<EncryptStringMethodResult>;
export type DecryptToStringMethod = (
	encryptedString: Blob,
	symmetricKey: Uint8Array
) => Promise<DecryptToStringMethodResult>;
export type LitNetwork = (typeof LitNetworks)[keyof typeof LitNetworks];
export type LitCompatibleCosmosChain = (typeof LitCompatibleCosmosChains)[keyof typeof LitCompatibleCosmosChains];
export type LitProtocolOptions = {
	cosmosAuthWallet: Secp256k1HdWallet | Secp256k1Wallet;
	litNetwork?: LitNetwork;
	chain?: LitCompatibleCosmosChain;
};

export type LitContractsOptions = {
	ethereumAuthWallet: SignerLike;
	litNetwork?: LitNetwork;
};
export type LitContractsMintCapacityCreditsOptions = {
	requestsPerDay?: number;
	requestsPerSecond?: number;
	requestsPerKilosecond?: number;
	effectiveDays: number;
};
export type LitContractsCreateCapacityDelegationAuthSignatureOptions = {
	dAppOwnerWallet: SignerLike;
	capacityTokenId: string;
	delegateeAddresses: string[];
	uses?: string;
	domain?: string;
	expiration?: string;
	statement?: string;
};
export type MintCapacityCreditsResult = MintCapacityCreditsRes;
export type CreateCapacityDelegationAuthSignatureResult = {
	capacityDelegationAuthSig: GenericAuthSig;
};

export type TxNonceFormat = (typeof TxNonceFormats)[keyof typeof TxNonceFormats];
export type PrivateKeyLiteral = `0x${string}`;

export const LitNetworks = {
	datil: 'datil',
	datilTest: 'datil-test',
	datildev: 'datil-dev',
	localhost: 'localhost',
} as const;
export const LitCompatibleCosmosChains = {
	cosmos: 'cosmos',
	cheqdMainnet: 'cheqdMainnet',
	cheqdTestnet: 'cheqdTestnet',
} as const;
export const TxNonceFormats = { entropy: 'entropy', uuid: 'uuid', timestamp: 'timestamp' } as const;
export const DefaultLitNetworkRPCUrls = {
	[LitNetworks.datil]: LIT_RPC.CHRONICLE,
	[LitNetworks.datilTest]: LIT_RPC.CHRONICLE_YELLOWSTONE,
	[LitNetworks.datildev]: LIT_RPC.CHRONICLE_YELLOWSTONE,
	[LitNetworks.localhost]: LIT_RPC.LOCAL_ANVIL,
} as const;

export class LitProtocol {
	client: LitNodeClientNodeJs | LitNodeClient;
	litNetwork: LitNetwork = LitNetworks.datildev;
	chain: LitCompatibleCosmosChain = LitCompatibleCosmosChains.cosmos;
	private readonly cosmosAuthWallet: Secp256k1HdWallet | Secp256k1Wallet;

	private constructor(options: LitProtocolOptions) {
		// validate options
		if (options.litNetwork && !Object.values(LitNetworks).includes(options.litNetwork))
			throw new Error(`[did-provider-cheqd]: lit-protocol: Invalid LitNetwork: ${options.litNetwork}`);
		if (options.chain && !Object.values(LitCompatibleCosmosChains).includes(options.chain))
			throw new Error(`[did-provider-cheqd]: lit-protocol: Invalid LitCompatibleCosmosChain: ${options.chain}`);

		// set options
		if (options.litNetwork) this.litNetwork = options.litNetwork;
		if (options.chain) this.chain = options.chain;
		this.cosmosAuthWallet = options.cosmosAuthWallet;

		// set client as per environment
		this.client = (function (that: LitProtocol) {
			if (isNode) return new LitNodeClientNodeJs({ litNetwork: that.litNetwork, debug: LitProtocolDebugEnabled });
			if (isBrowser) return new LitNodeClient({ litNetwork: that.litNetwork, debug: LitProtocolDebugEnabled });
			throw new Error('[did-provider-cheqd]: lit-protocol: Unsupported runtime environment');
		})(this);
	}

	async connect(): Promise<void> {
		return await this.client.connect();
	}

	async encrypt(
		secret: Uint8Array,
		unifiedAccessControlConditions: NonNullable<UnifiedAccessControlConditions>
	): Promise<ThresholdEncryptionResult> {
		try {
			// encrypt
			const { ciphertext: encryptedString, dataToEncryptHash: stringHash } = (await this.client.encrypt({
				dataToEncrypt: secret,
				unifiedAccessControlConditions,
			})) satisfies EncryptStringMethodResult;

			return {
				encryptedString: fromString(encryptedString, 'base64'),
				stringHash,
			};
		} catch (error: any) {
			console.error('Encryption failed:', error);
			if (error.stack) {
				console.error('Stack:', error.stack);
			}
			// standardize error
			throw new Error(
				`[did-provider-cheqd]: lit-protocol: Encryption failed: ${(error as Error).message || error}`
			);
		}
	}

	async decrypt(
		encryptedString: string,
		stringHash: string,
		unifiedAccessControlConditions: NonNullable<UnifiedAccessControlConditions>,
		capacityDelegationAuthSig?: GenericAuthSig
	): Promise<string> {
        try {
		// generate session signatures
		const sessionSigs = await this.client.getSessionSigs({
			chain: 'cheqd',
			resourceAbilityRequests: [
				{
					resource: new LitAccessControlConditionResource('*'),
					ability: LitAbility.AccessControlConditionDecryption,
				},
			],
			capabilityAuthSigs: capacityDelegationAuthSig ? [capacityDelegationAuthSig] : undefined,
			authNeededCallback: async ({ }) => {
				// generate auth signature
				const authSig = await LitProtocol.generateAuthSignature(this.cosmosAuthWallet);
				return authSig;
			},
		});

		// decrypt
		const { decryptedData } = (await this.client.decrypt({
			chain: this.chain,
			ciphertext: encryptedString,
			dataToEncryptHash: stringHash,
			unifiedAccessControlConditions: [unifiedAccessControlConditions],
			sessionSigs,
		})) satisfies DecryptToStringMethodResult;

		return toString(decryptedData, 'utf-8');

        } catch (error: any) {
			console.error('Decryption failed:', error);
			if (error.stack) {
				console.error('Stack:', error.stack);
			}
			// standardize error
			throw new Error(
				`[did-provider-cheqd]: lit-protocol: Decryption failed: ${(error as Error).message || error}`
			);
		}
	}

    async decryptV6(
		encryptedString: string,
		stringHash: string,
		unifiedAccessControlConditions: NonNullable<UnifiedAccessControlConditions>,
        pkpPublicKey: string,
		capacityDelegationAuthSig?: GenericAuthSig
	): Promise<string> {
        try {
		// generate session signatures
		const sessionSigs = await this.client.getLitActionSessionSigs({
			chain: 'cheqd',
			resourceAbilityRequests: [
				{
					resource: new LitAccessControlConditionResource('*'),
					ability: LitAbility.AccessControlConditionDecryption,
				},
			],
			capabilityAuthSigs: capacityDelegationAuthSig ? [capacityDelegationAuthSig] : undefined,
            litActionCode: Buffer.from(litActionCode).toString('base64'),
			jsParams:  await LitProtocol.generateAuthSignature(this.cosmosAuthWallet),
            pkpPublicKey
		});

        console.log("Generated sessiong sigs", sessionSigs)

		// decrypt
		const { decryptedData } = (await this.client.decrypt({
			chain: this.chain,
			ciphertext: encryptedString,
			dataToEncryptHash: stringHash,
			unifiedAccessControlConditions,
			sessionSigs,
		})) satisfies DecryptToStringMethodResult;

		return toString(decryptedData, 'utf-8');

                } catch (error: any) {
			console.error('Decryption failed:', error);
			if (error.stack) {
				console.error('Stack:', error.stack);
			}
			// standardize error
			throw new Error(
				`[did-provider-cheqd]: lit-protocol: Decryption failed: ${(error as Error).message || error}`
			);
		}
	}

	async delegateCapacitCredit(
		options: LitContractsCreateCapacityDelegationAuthSignatureOptions
	): Promise<CreateCapacityDelegationAuthSignatureResult> {
		return await this.client.createCapacityDelegationAuthSig({
			dAppOwnerWallet: options.dAppOwnerWallet,
			capacityTokenId: options.capacityTokenId,
			delegateeAddresses: options.delegateeAddresses,
			uses: options.uses,
			domain: options.domain,
			expiration: options.expiration,
			statement: options.statement,
		});
	}

	static async encryptDirect(data: Uint8Array): Promise<SymmetricEncryptionResult> {
		try {
			// generate symmetric key
			const symmetricKey = await generateSymmetricKey();

			// generate iv
			const iv = crypto.getRandomValues(new Uint8Array(12));

			// encrypt
			const encrypted = await crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv,
				},
				symmetricKey,
				data
			);

			// export symmetric key
			const exportedSymmetricKey = await crypto.subtle.exportKey('raw', symmetricKey);

			return {
				encryptedString: new Blob([iv, new Uint8Array(encrypted)]),
				stringHash: toString(new Uint8Array(await crypto.subtle.digest('SHA-256', data)), 'hex'),
				symmetricKey: new Uint8Array(exportedSymmetricKey),
			} satisfies SymmetricEncryptionResult;
		} catch (error) {
			// standardize error
			throw new Error(
				`[did-provider-cheqd]: symmetric-encryption: Encryption failed: ${(error as Error).message || error}`
			);
		}
	}

	static async decryptDirect(encryptedString: Blob, symmetricKey: Uint8Array): Promise<Uint8Array> {
		try {
			// import symmetric key
			const importedSymmetricKey = await crypto.subtle.importKey(
				'raw',
				symmetricKey,
				{
					name: 'AES-GCM',
				},
				true,
				['encrypt', 'decrypt']
			);

			// extract iv and encrypted data
			const [iv, encryptedData] = await Promise.all([
				encryptedString.slice(0, 12).arrayBuffer(),
				encryptedString.slice(12).arrayBuffer(),
			]);

			// decrypt
			const decrypted = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: new Uint8Array(iv),
				},
				importedSymmetricKey,
				encryptedData
			);

			return new Uint8Array(decrypted);
		} catch (error) {
			// standardize error
			throw new Error(
				`[did-provider-cheqd]: symmetric-decryption: Decryption failed: ${(error as Error).message || error}`
			);
		}
	}

	static async create(options: Partial<LitProtocolOptions>): Promise<LitProtocol> {
		// instantiate underlying cosmos auth wallet
		if (!options.cosmosAuthWallet)
			options.cosmosAuthWallet = await Secp256k1HdWallet.generate(24, {
				prefix: await LitProtocol.getCosmosWalletPrefix(options?.chain),
			});

		// validate top-level options chain
		if (!options?.chain) options.chain = LitCompatibleCosmosChains.cheqdTestnet;

		// validate top-level options litNetwork
		if (!options?.litNetwork) options.litNetwork = LitNetworks.datildev;

		const litProtocol = new LitProtocol(options as LitProtocolOptions);
		await litProtocol.connect();
		// Initialize BLS SDK WASM module explicitly
		try {
			await initWasmBlsSdk();
		} catch (initError) {
			console.error('BLS SDK WASM initialization failed:', initError);
		}
		return litProtocol;
	}

	static async getCosmosWalletPrefix(chain?: LitCompatibleCosmosChain): Promise<string> {
		switch (chain) {
			case LitCompatibleCosmosChains.cosmos:
				return 'cosmos';
			case LitCompatibleCosmosChains.cheqdMainnet:
				return 'cheqd';
			case LitCompatibleCosmosChains.cheqdTestnet:
				return 'cheqd';
			default:
				return 'cheqd';
		}
	}

	static async generateAuthSignature(wallet: OfflineAminoSigner): Promise<AuthSignature> {
		const signerAddress = (await wallet.getAccounts())[0].address;
		const signData = await LitProtocol.generateSignData();
		const signDoc = await LitProtocol.generateSignDoc(signerAddress, signData);
		const result = await wallet.signAmino(signerAddress, signDoc);
		return {
			address: signerAddress,
            pubKey: toString((await wallet.getAccounts())[0].pubkey, 'utf-8'),
            algo: (await wallet.getAccounts())[0].algo,
			derivedVia: 'cosmos.signArbitrary',
			sig: result.signature.signature,
			signedMessage: toString(sha256(new TextEncoder().encode(JSON.stringify(signDoc))), 'hex'), // <-- hex encoded sha256 hash of the json stringified signDoc
		};
	}

	static async generateSignDoc(address: string, data: Uint8Array): Promise<StdSignDoc> {
		return {
			account_number: '0',
			chain_id: '',
			fee: {
				amount: [],
				gas: '0',
			},
			memo: '',
			msgs: [
				{
					type: 'sign/MsgSignData',
					value: {
						data: toString(data, 'base64'),
						signer: address,
					},
				},
			],
			sequence: '0',
		}; // <-- should be sorted alphabetically
	}

	static async generateSignData(): Promise<Uint8Array> {
		return new TextEncoder().encode(`I am creating an account to use Lit Protocol at 2023-02-21T16:40:15.305Z`); // <-- lit nodes search for this string in the signData
	}

	static async generateTxNonce(format?: TxNonceFormat, entropyLength?: number): Promise<string> {
		switch (format) {
			case TxNonceFormats.entropy:
				return toString(await randomBytes(entropyLength || 64), 'hex');
			case TxNonceFormats.uuid:
				return v4();
			case TxNonceFormats.timestamp:
				return new Date().toISOString();
			default:
				return v4();
		}
	}

	static async generateCosmosAccessControlConditionBalance(
		returnValueTest: CosmosReturnValueTest,
		chain: LitCompatibleCosmosChain = LitCompatibleCosmosChains.cheqdTestnet,
		address = ':userAddress'
	): Promise<CosmosAccessControlCondition> {
		return {
			conditionType: 'cosmos',
			path: `/cosmos/bank/v1beta1/balances/${address}`,
			chain,
			returnValueTest,
		};
	}

	static async generateCosmosAccessControlConditionTransactionMemo(
		returnValueTest: CosmosReturnValueTest,
		amount: string,
		sender: string,
		recipient = ':userAddress',
		chain: LitCompatibleCosmosChain = LitCompatibleCosmosChains.cheqdTestnet
	): Promise<CosmosAccessControlCondition> {
		return {
			conditionType: 'cosmos',
			path: `/cosmos/tx/v1beta1/txs?events=transfer.recipient='${recipient}'&events=transfer.sender='${sender}'&events=transfer.amount='${amount}'&order_by=2`,
			chain,
			returnValueTest,
		};
	}

	static async generateCosmosAccessControlConditionInverseTimelock(
		returnValueTest: CosmosReturnValueTest,
		amount: string,
		recipient = ':userAddress',
		blockHeight = 'latest',
		chain: LitCompatibleCosmosChain = LitCompatibleCosmosChains.cheqdTestnet
	): Promise<CosmosAccessControlCondition> {
		return {
			conditionType: 'cosmos',
			path: `/cosmos/tx/v1beta1/txs?events=transfer.recipient='${recipient}'&events=transfer.amount='${amount}'&order_by=2&pagination.limit=1`,
			chain,
			method: 'timelock',
			parameters: [blockHeight],
			returnValueTest,
		};
	}
}

export class LitContracts {
	client: LitContractsClient;
	litNetwork: LitNetwork = LitNetworks.datildev;
	private readonly ethereumAuthWallet: SignerLike;

	constructor(options: LitContractsOptions) {
		// validate options
		if (options.litNetwork && !Object.values(LitNetworks).includes(options.litNetwork))
			throw new Error(`[did-provider-cheqd]: lit-contracts: Invalid LitNetwork: ${options.litNetwork}`);

		// set options
		if (options.litNetwork) this.litNetwork = options.litNetwork;
		this.ethereumAuthWallet = options.ethereumAuthWallet;

		// set client
		this.client = new LitContractsClient({ provider: new ethers.providers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE), signer: this.ethereumAuthWallet, network: this.litNetwork });
	}

	async connect(): Promise<void> {
		return await this.client.connect();
	}

	async mintCapacityCredits(options: LitContractsMintCapacityCreditsOptions): Promise<MintCapacityCreditsResult> {
		return await this.client.mintCapacityCreditsNFT({
			requestsPerDay: options.requestsPerDay,
			requestsPerSecond: options.requestsPerSecond,
			requestsPerKilosecond: options.requestsPerKilosecond,
			daysUntilUTCMidnightExpiration: options.effectiveDays,
		});
	}

    async calculateLitActionCodeCID(input: string): Promise<string> {
    try {
        const cid = await ipfsOnlyHash.of(input);
        return cid;
    } catch (error) {
        console.error("Error calculating CID for litActionCode:", error);
        throw error;
    }
    }


    async mintPkp() {
        const authMethodType = ethers.utils.keccak256(
            // should be unique
            ethers.utils.toUtf8Bytes("Lit Cheqd Cosmos Authentication")
        );
        
        const authMethodId = ethers.utils.keccak256(
            ethers.utils.toUtf8Bytes(`cheqd:lit`)
        );
    
        const tx = await this.client.pkpHelperContractUtil.write.mintNextAndAddAuthMethods({
            permittedAuthMethodIds: [ `0x${Buffer.from(
                ethers.utils.base58.decode(
                    await this.calculateLitActionCodeCID(litActionCode)
                )
        ).toString("hex")}`, authMethodId],
            permittedAuthMethodTypes: [ AuthMethodType.LitAction.toString(), authMethodType],
            permittedAuthMethodScopes: [ [ AuthMethodScope.SignAnything.toString() ], [ AuthMethodScope.NoPermissions.toString() ] ],
            keyType: AuthMethodType.LitAction.toString(),
            sendPkpToItself: false,
            addPkpEthAddressAsPermittedAddress: true,
            permittedAuthMethodPubkeys: ["0x", "0x"]
        });

        const receipt = await tx.wait()

        return await this.getPkpInfoFromMintReceipt(receipt)
    }

    async getPkpInfoFromMintReceipt (
        txReceipt: ethers.ContractReceipt,
    ) {
        const pkpMintedEvent = txReceipt!.events!.find(
            (event) =>
            event.topics[0] ===
            "0x3b2cc0657d0387a736293d66389f78e4c8025e413c7a1ee67b7707d4418c46b8"
        );

        const publicKey = "0x" + pkpMintedEvent!.data.slice(130, 260);
        const tokenId = ethers.utils.keccak256(publicKey);
        const ethAddress = await this.client.pkpNftContract.read.getEthAddress(
            tokenId
        );

        return {
            tokenId: ethers.BigNumber.from(tokenId).toString(),
            publicKey,
            ethAddress,
        };
};

	static async create(options: Partial<LitContractsOptions>): Promise<LitContracts> {
		// instantiate underlying ethereum auth wallet
		if (!options.ethereumAuthWallet)
			throw new Error("Wallet not found")

		// validate top-level options litNetwork
		if (!options?.litNetwork) options.litNetwork = LitNetworks.datildev;

		const litContracts = new LitContracts(options as LitContractsOptions);
		await litContracts.connect();
		return litContracts;
	}

	static async generateRandomEthereumAuthWallet(): Promise<ethers.Wallet> {
		// generate private key + wallet
		return new ethers.Wallet(await LitContracts.generateRandomPrivateKey<PrivateKeyLiteral>());
	}

	static async generateRandomPrivateKey<T extends Uint8Array | PrivateKeyLiteral = PrivateKeyLiteral>(
		length = 32,
		raw = false
	): Promise<T> {
		// ensure crypto, if applicable
		const crypto = await (async function () {
			if (isNode) return (await import('crypto')).default as Crypto;
			if (isBrowser) return window.crypto;
			throw new Error('[did-provider-cheqd]: lit-contracts: Unsupported runtime environment');
		})();

		// generate random raw private key
		const rawPrivateKey = crypto.getRandomValues(new Uint8Array(length));

		// return as per request
		return (raw ? rawPrivateKey : `0x${toString(rawPrivateKey, 'hex')}`) as T;
	}
}
