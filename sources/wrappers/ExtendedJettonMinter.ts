import {
    ChangeOwner,
    JettonMinter,
    JettonUpdateContent,
    Mint,
    ProvideWalletAddress,
} from "../output/Jetton_JettonMinter"
import {Address, beginCell, Cell, ContractProvider, Sender, toNano} from "@ton/core"

export class ExtendedJettonMinter extends JettonMinter {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(totalSupply: bigint, owner: Address, jettonContent: Cell) {
        const base = await JettonMinter.fromInit(totalSupply, owner, jettonContent, true)
        if (base.init === undefined) {
            throw new Error("JettonMinter init is not defined")
        }
        return new ExtendedJettonMinter(base.address, {code: base.init.code, data: base.init.data})
    }

    async getTotalSupply(provider: ContractProvider): Promise<bigint> {
        const res = await this.getGetJettonData(provider)
        return res.totalSupply
    }

    async getWalletAddress(provider: ContractProvider, owner: Address): Promise<Address> {
        return this.getGetWalletAddress(provider, owner)
    }

    async getAdminAddress(provider: ContractProvider): Promise<Address> {
        const res = await this.getGetJettonData(provider)
        return res.adminAddress
    }

    async getContent(provider: ContractProvider): Promise<Cell> {
        const res = await this.getGetJettonData(provider)
        return res.jettonContent
    }

    async sendMint(
        provider: ContractProvider,
        via: Sender,
        to: Address,
        jetton_amount: bigint,
        forward_ton_amount: bigint,
        total_ton_amount: bigint,
    ): Promise<void> {
        if (total_ton_amount <= forward_ton_amount) {
            throw new Error("Total TON amount should be greater than the forward amount")
        }
        const msg: Mint = {
            $$type: "Mint",
            queryId: 0n,
            receiver: to,
            tonAmount: total_ton_amount,
            mintMessage: {
                $$type: "JettonTransferInternal",
                queryId: 0n,
                amount: jetton_amount,
                sender: this.address,
                responseDestination: this.address,
                forwardTonAmount: forward_ton_amount,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            },
        }
        return this.send(provider, via, {value: total_ton_amount + toNano("0.015")}, msg)
    }

    async sendChangeAdmin(
        provider: ContractProvider,
        via: Sender,
        newOwner: Address,
    ): Promise<void> {
        const msg: ChangeOwner = {
            $$type: "ChangeOwner",
            queryId: 0n,
            newOwner: newOwner,
        }
        return this.send(provider, via, {value: toNano("0.05")}, msg)
    }

    async sendChangeContent(provider: ContractProvider, via: Sender, content: Cell): Promise<void> {
        const msg: JettonUpdateContent = {
            $$type: "JettonUpdateContent",
            queryId: 0n,
            content: content,
        }
        return this.send(provider, via, {value: toNano("0.05")}, msg)
    }

    async sendDiscovery(
        provider: ContractProvider,
        via: Sender,
        address: Address,
        includeAddress: boolean,
        value: bigint = toNano("0.1"),
    ): Promise<void> {
        const msg: ProvideWalletAddress = {
            $$type: "ProvideWalletAddress",
            queryId: 0n,
            ownerAddress: address,
            includeAddress: includeAddress,
        }
        return this.send(provider, via, {value: value}, msg)
    }
}
