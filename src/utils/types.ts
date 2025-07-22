import { CheqdNetwork } from "@cheqd/sdk";

export interface ICheqdMintCapacityCreditArgs {
	network: CheqdNetwork;
	effectiveDays: number;
	requestsPerDay?: number;
	requestsPerSecond?: number;
	requestsPerKilosecond?: number;
}

export interface ICheqdDelegateCapacityCreditArgs {
	network: CheqdNetwork;
	capacityTokenId: string;
	delegateeAddresses: string[];
	usesPermitted: number;
	expiration?: string;
	statement?: string;
}