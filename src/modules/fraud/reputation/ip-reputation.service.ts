import { Injectable } from '@nestjs/common';

export interface IpReputationResult {
  vpn?: boolean;
  proxy?: boolean;
  tor?: boolean;
  datacenter?: boolean;
  country?: string;
  asn?: string;
  riskScore?: number;
  unavailable?: boolean;
}

export interface IpReputationProvider {
  lookup(ip: string): Promise<IpReputationResult>;
}

@Injectable()
export class NoOpIpReputationProvider implements IpReputationProvider {
  async lookup(): Promise<IpReputationResult> {
    return { unavailable: true, riskScore: 0 };
  }
}
