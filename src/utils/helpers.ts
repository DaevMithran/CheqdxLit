import { fromString, toString } from 'uint8arrays';

export type SymmetricEncryptionCipherText = string;
export type ThresholdEncryptionCipherText = string;
export type EncodedList = `${SymmetricEncryptionCipherText}-${ThresholdEncryptionCipherText}` | string;
export type EncodedListAsArray = [SymmetricEncryptionCipherText, ThresholdEncryptionCipherText];

export function isEncodedList(list: unknown): list is EncodedList {
	return typeof list === 'string' && list.split('-').every((item) => typeof item === 'string' && item && item.length);
}

export function getEncodedList(list: unknown, validate = true): EncodedListAsArray {
	if (validate && !isEncodedList(list)) throw new Error('Invalid encoded list');
	const [symmetricEncryptionCipherText, ThresholdEncryptionCipherText] = (list as EncodedList).split('-');
	return [symmetricEncryptionCipherText, ThresholdEncryptionCipherText] as const;
}

export async function generateSymmetricKey(params?: AesKeyGenParams): Promise<CryptoKey> {
	return await crypto.subtle.generateKey(
		params || {
			name: 'AES-GCM',
			length: 256,
		},
		true,
		['encrypt', 'decrypt']
	);
}

export async function safeDeserialise<T>(
	string: string,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	deserialiser: (string: string, ...args: any[]) => T,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	deserialiserArgs: any[] = [],
	message?: string
): Promise<T> {
	try {
		return await deserialiser(string, ...deserialiserArgs);
	} catch (error) {
		return message
			? (function () {
					throw new Error(
						`[did-provider-cheqd]: deserialise: ${message}: ${(error as Error).message || error}`
					);
				})()
			: (function () {
					throw error;
				})();
	}
}

export async function randomFromRange(min: number, max: number, notIn: number[]): Promise<number> {
	const random = Math.floor(Math.random() * (max - min + 1) + min);
	if (notIn.includes(random)) {
		return await randomFromRange(min, max, notIn);
	}
	return random;
}

export async function randomUniqueSubsetInRange(min: number, max: number, count: number): Promise<Array<number>> {
	const subset: number[] = [];
	for (let i = 0; i < count; i++) {
		subset.push(await randomFromRange(min, max, subset));
	}
	return subset;
}

export async function randomBytes(length: number): Promise<Buffer> {
	return Buffer.from(Array.from({ length }, () => Math.floor(Math.random() * 256)));
}

export async function initialiseIndexArray(length: number): Promise<Array<boolean>> {
	return Array(length).fill(true);
}

export async function shuffleArray<T>(array: Array<T>): Promise<Array<T>> {
	const shuffled = array.sort(() => Math.random() - 0.5);
	return shuffled;
}

export async function toBlob(data: Uint8Array): Promise<Blob> {
	return new Blob([data]);
}

export async function blobToHexString(blob: Blob): Promise<string> {
	// buffer from blob
	const buffer = await blob.arrayBuffer();

	// convert buffer to uint8Array
	const uint8Array = new Uint8Array(buffer);

	return toString(uint8Array, 'hex');
}


export function unescapeUnicode(str: string): string {
	return str.replace(/\\u([a-fA-F0-9]{4})/g, (m, cc) => {
		return String.fromCharCode(parseInt(cc, 16));
	});
}

/**
 * Check if encoded bitstring is valid base64url format
 */
export function isValidEncodedBitstring(encodedList: string): boolean {
	try {
		// Should be valid base64url
		fromString(encodedList, 'base64url');
		return true;
	} catch {
		return false;
	}
}
