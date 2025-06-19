//  SPDX-License-Identifier: MIT
//  Copyright © 2025 TON Studio

import {
    ChangeOwner,
    ClaimTON,
    gasForBurn,
    gasForTransfer,
    JettonMinter,
    JettonUpdateContent,
    Mint,
    minTonsForStorage,
    ProvideWalletAddress,
    storeMint,
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

    /**
     * Sends a mint message to the Jetton Minter contract to mint new Jettons for a specified recipient.
     *
     * @param provider - The contract provider used to interact with the blockchain.
     * @param via - The sender object representing the wallet or account initiating the mint operation.
     * @param to - The recipient address to which the newly minted Jettons will be sent.
     * @param jettonAmount - The amount of Jettons to mint.
     * @param forwardTonAmount - The amount of TONs to forward to the recipient along with the Jettons.
     * @param totalTonAmount - The total amount of TONs to attach to the mint operation for fees and forwarding.
     *
     * @throws {Error} If the `totalTonAmount` is less than or equal to the `forwardTonAmount`.
     *
     * @returns A promise that resolves when the mint message has been sent.
     *
     * @example
     * await jettonMinter.sendMint(
     *     provider,
     *     sender,
     *     recipientAddress,
     *     toNano("1000"), // Jetton amount
     *     toNano("0.05"), // Forward TON amount
     *     toNano("0.1"),  // Total TON amount
     * );
     */
    async sendMint(
        provider: ContractProvider,
        via: Sender,
        to: Address,
        jettonAmount: bigint,
        forwardTonAmount: bigint,
        totalTonAmount: bigint,
    ): Promise<void> {
        if (totalTonAmount <= forwardTonAmount) {
            throw new Error("Total TON amount should be greater than the forward amount")
        }
        const msg: Mint = {
            $$type: "Mint",
            queryId: 0n,
            receiver: to,
            mintMessage: {
                $$type: "JettonTransferInternal",
                queryId: 0n,
                amount: jettonAmount,
                sender: this.address,
                responseDestination: this.address,
                forwardTonAmount: forwardTonAmount,
                forwardPayload: beginCell().storeUint(0, 1).asSlice(),
            },
        }
        return this.send(provider, via, {value: totalTonAmount + toNano("0.015")}, msg)
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

    async sendClaimTon(
        provider: ContractProvider,
        via: Sender,
        address: Address,
        value: bigint = toNano("0.1"),
    ): Promise<void> {
        const msg: ClaimTON = {
            $$type: "ClaimTON",
            receiver: address,
        }
        return this.send(provider, via, {value: value}, msg)
    }

    loadMintMessage(
        mintAmount: bigint,
        receiver: Address,
        sender: Address,
        responseDestination: Address,
        forwardTonAmount: bigint,
        forwardPayload: Cell | null,
    ): Cell {
        return beginCell()
            .store(
                storeMint({
                    $$type: "Mint",
                    mintMessage: {
                        $$type: "JettonTransferInternal",
                        amount: mintAmount,
                        sender: sender,
                        responseDestination: responseDestination,
                        queryId: 0n,
                        forwardTonAmount: forwardTonAmount,
                        forwardPayload: beginCell().storeMaybeRef(forwardPayload).asSlice(),
                    },
                    queryId: 0n,
                    receiver: receiver,
                }),
            )
            .endCell()
    }

    loadGasForBurn(): bigint {
        return gasForBurn
    }

    loadGasForTransfer(): bigint {
        return gasForTransfer
    }

    loadMinTonsForStorage(): bigint {
        return minTonsForStorage
    }
}
