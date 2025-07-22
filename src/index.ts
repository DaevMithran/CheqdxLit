import { Secp256k1HdWallet } from "@cosmjs/amino";
import { CreateCapacityDelegationAuthSignatureResult, LitContracts, LitNetwork, LitProtocol, MintCapacityCreditsResult } from "./v6";
import { DirectSecp256k1HdWallet } from "@cosmjs/proto-signing";
import { 
    AbstractCheqdSDKModule,
    CheqdSDK,
    createCheqdSDK,
    createDidPayload,
    createDidVerificationMethod,
    createKeyPairBase64,
    createVerificationKeys,
    DIDDocument,
    DIDModule,
    DidStdFee,
    FeemarketModule,
    ICheqdSDKOptions,
    IKeyPair,
    ISignInputs,
    MethodSpecificIdAlgo,
    ResourceModule,
    VerificationMethods
} from "@cheqd/sdk";
import { ethers } from "ethers";
import { fromString, toString } from "uint8arrays";
import { MsgCreateResourcePayload } from "@cheqd/ts-proto/cheqd/resource/v2"
import { v4 } from "uuid";
import { blobToHexString, getEncodedList } from "./utils";
import { UnifiedAccessControlConditions } from "@lit-protocol/types";
import { LIT_RPC } from "@lit-protocol/constants";

const mnemonic = "sketch mountain erode window enact net enrich smoke claim kangaroo another visual write meat latin bacon pulp similar forum guilt father state erase bright"
const address = "cheqd1rnr5jrt4exl0samwj0yegv99jeskl0hsxmcz96"
const signer = Secp256k1HdWallet.fromMnemonic(mnemonic)
const cosmosWallet = DirectSecp256k1HdWallet.fromMnemonic(mnemonic, { prefix: 'cheqd' })
const ethereumWallet = ethers.Wallet.fromPhrase(mnemonic)
ethereumWallet.connect(new ethers.JsonRpcProvider(LIT_RPC.CHRONICLE_YELLOWSTONE))
const paymentConditions = {
    intervalInSeconds: 5 * 60,
    amount:  `${100}` ,
    toAddress: "cheqd1l9sq0se0jd3vklyrrtjchx4ua47awug5vsyeeh",
    denom: "ncheq"
}

async function instantiateDkgThresholdProtocolClient(): Promise<LitProtocol> {
    return await LitProtocol.create({
        chain: 'cheqdTestnet',
        litNetwork: 'datil-dev',
        cosmosAuthWallet: await signer,
    });
}

async function instantiateDkgThresholdContractClient(): Promise<LitContracts> {
    return await LitContracts.create({
        ethereumAuthWallet: ethereumWallet,
        litNetwork: 'datil-dev',
    });
}

async function mintCapacityCredit(args: {
    effectiveDays: number;
    requestsPerDay?: number;
    requestsPerSecond?: number;
    requestsPerKilosecond?: number;
}): Promise<MintCapacityCreditsResult> {
    // instantiate dkg-threshold contract client, in which case lit-protocol is used
    const litContracts = await instantiateDkgThresholdContractClient();

    // mint capacity credits
    const result = await litContracts.mintCapacityCredits(args);

    // keep log
    console.log(
        'Minted capacity credits',
        result.capacityTokenIdStr,
        'for',
        args.effectiveDays,
        'days',
        'with transaction hash',
        result.rliTxHash,
        'from address',
        ethereumWallet.address
    );

    return result;
}

async function delegateCapacityCredit(args: {
    capacityTokenId: string;
    delegateeAddresses: string[];
    uses: number;
    expiration?: string;
    statement?: string;
}): Promise<CreateCapacityDelegationAuthSignatureResult> {
    // instantiate dkg-threshold client, in which case lit-protocol is used
    const litProtocol = await instantiateDkgThresholdProtocolClient();

    // delegate capacity credits
    const result = await litProtocol.delegateCapacitCredit({
        dAppOwnerWallet:
            ethereumWallet instanceof ethers.Wallet
                ? ethereumWallet
                : new ethers.Wallet(ethereumWallet.privateKey),
        capacityTokenId: args.capacityTokenId,
        delegateeAddresses: args.delegateeAddresses,
        uses: args.uses.toString(),
        expiration: args.expiration,
        statement: args.statement,
    });

    // keep log
    console.log(
        'Delegated capacity credits',
        args.capacityTokenId,
        'to',
        args.delegateeAddresses.join(', '),
        'with auth signature',
        result.capacityDelegationAuthSig.sig,
        'from address',
        ethereumWallet.address
    );

    return result;
}

const createDid = async (keyPair: IKeyPair, feePayer: string, cheqdSDK: CheqdSDK) => {
  // create verification keys
  const verificationKeys = createVerificationKeys(
    keyPair.publicKey,
    MethodSpecificIdAlgo.Uuid,
    "key-1"
  );

  // create verification methods
  const verificationMethods = createDidVerificationMethod(
    [VerificationMethods.Ed255192020],
    [verificationKeys]
  );

  // create did document
  const didDocument = createDidPayload(verificationMethods, [verificationKeys]);

  // create sign inputs
  const signInputs = [
    {
      verificationMethodId: didDocument.verificationMethod![0].id as string,
      privateKeyHex: toString(fromString(keyPair.privateKey, "base64"), "hex"),
    },
  ] satisfies ISignInputs[];

  // define fee amount
  const fee = await DIDModule.generateCreateDidDocFees(feePayer);

  // create did
  const createDidDocResponse = await cheqdSDK.createDidDocTx(
    signInputs,
    didDocument,
    feePayer,
    undefined,
    undefined,
    undefined,
    { sdk: cheqdSDK }
  )

  console.warn('did document:', JSON.stringify(didDocument, null, 2));

  console.warn('did tx:', JSON.stringify(createDidDocResponse, null, 2));

  return didDocument
}

const createEncryptedResource = async (keyPair: IKeyPair, feePayer: string, cheqdSdk: CheqdSDK, didDocument: DIDDocument) => {
    const { encryptedString: symmetricEncryptionCiphertext, symmetricKey } = await LitProtocol.encryptDirect(fromString("Hello World"));

    console.log(symmetricKey)

    // instantiate dkg-threshold client, in which case lit-protocol is used
    const lit = await instantiateDkgThresholdProtocolClient();

    // construct access control conditions
    const unifiedAccessControlConditions = [
        await LitProtocol.generateCosmosAccessControlConditionInverseTimelock(
            {
                key: '$.tx_responses.*.timestamp',
                comparator: '<=',
                value: `${paymentConditions.intervalInSeconds}`,
            },
            `${paymentConditions.amount}${paymentConditions.denom}`,
            `${paymentConditions.toAddress}`,
            undefined,
            "cheqdTestnet"
        )
    ];

    // encrypt bitstring - case: threshold
    const { encryptedString: thresholdEncryptionCiphertext, stringHash } = await lit.encrypt(
        fromString("Hello World"),
        unifiedAccessControlConditions
    );

    const encoded = `${await blobToHexString(symmetricEncryptionCiphertext)}-${toString(
        thresholdEncryptionCiphertext,
        'hex'
    )}`;
    
    const payload: Partial<MsgCreateResourcePayload> = {
        collectionId: didDocument.id.split(':')[3],
        id: v4(),
        data: fromString(JSON.stringify({
            encoded,
            hash: stringHash,
            conditions: paymentConditions
        }), 'utf-8'),
        name: 'encrypted',
        resourceType: 'encrypted'
    }

    const signInputs = [
        {
          keyType: 'Ed25519',
          verificationMethodId: didDocument.verificationMethod![0].id as string,
          privateKeyHex: toString(fromString(keyPair.privateKey, "base64"), "hex"),
        },
      ] satisfies ISignInputs[];

    const tx = await cheqdSdk.createLinkedResourceTx(signInputs, payload, feePayer, undefined, undefined, { sdk: cheqdSdk })

    console.warn('resource tx:', JSON.stringify(tx, null, 2));
    if(tx.code === 0) {
        return payload.id
    }
}

const decryptResource = async (did: string, resourceId: string) => {
    const response = await (await fetch(`https://resolver.cheqd.net/1.0/identifiers/${did}/resources/${resourceId}`)).json() as { encoded: string, hash: string, conditions: UnifiedAccessControlConditions} | undefined
    if (!response) {
        console.log("Error fetching resource")
        return
    }

    const thresholdEncryptionCiphertext = getEncodedList(response.encoded, false)[1];

    // instantiate dkg-threshold client, in which case lit-protocol is used
    const lit = await instantiateDkgThresholdProtocolClient();

    // mint and delegate
    const mintedRes = await mintCapacityCredit({ effectiveDays: 1 })

    const { capacityDelegationAuthSig } = await delegateCapacityCredit({
        capacityTokenId: mintedRes.capacityTokenId,
		delegateeAddresses: [address],
		uses: 5
    })

    const decrypted = await lit.decrypt(
        thresholdEncryptionCiphertext,
        response.hash,
        response.conditions,
        capacityDelegationAuthSig
    )
    
   return decrypted
}

async function transactSendTokens(cheqdSdk: CheqdSDK): Promise<any> {
    // poll gas price
    const gasPrice = await cheqdSdk.queryGasPrice(paymentConditions.denom, { sdk: cheqdSdk });

    console.log(gasPrice)
    // define fee
    const fee = {
        amount: [
            {
                amount: "1800000000",
                denom: paymentConditions.denom,
            },
        ],
        gas: '360000',
        payer: address
    } satisfies DidStdFee;

    const tx = await cheqdSdk.signer.sendTokens(
        address,
        paymentConditions.toAddress,
        [{ amount: paymentConditions.amount, denom: paymentConditions.denom }],
        fee,
    );

    if(tx.code !== 0){ console.log(`cosmos_transaction: Failed to send tokens. Reason: ${tx.rawLog}`) };

    console.log('Sent tokens', paymentConditions.amount, paymentConditions.denom, 'to', paymentConditions.toAddress);

    return tx;
}

async function run() {
    const wallet = await cosmosWallet.catch(() => {
        throw new Error(`[did-provider-cheqd]: network: testnet valid cosmosPayerSeed is required`);
    }) as any;

    const sdkOptions: ICheqdSDKOptions = {
        modules: [
            FeemarketModule as unknown as AbstractCheqdSDKModule,
            DIDModule as unknown as AbstractCheqdSDKModule,
            ResourceModule as unknown as AbstractCheqdSDKModule,
        ],
        rpcUrl: 'https://rpc.cheqd.network',
        wallet: wallet,
    }

    const sdk = await createCheqdSDK(sdkOptions)

    const feePayer = (await wallet.getAccounts())[0].address;

    const keyPair = createKeyPairBase64();

    const didDocument = await createDid(keyPair, feePayer, sdk)

    const result = await createEncryptedResource(keyPair, feePayer, sdk, didDocument)
    if(!result) {
        console.log("Creating encrypted resource failed")
        return
    }

    // transfer tokens
    await transactSendTokens(sdk)
    console.log("Transfer complete")

    const decrypted = await decryptResource("did:cheqd:testnet:418df027-081d-4748-9b44-085739b97067", "0561742a-e014-4734-900f-71fed6cb408b")
    console.log("Decrypted Resource", decrypted)
}

run()