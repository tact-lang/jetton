import {JettonMinterFeatureRich} from "../output/FeatureRich_JettonMinterFeatureRich"
import {Address, Cell} from "@ton/core"
import {ExtendedJettonMinter} from "./ExtendedJettonMinter"

export class ExtendedFeatureRichJettonMinter extends ExtendedJettonMinter {
    constructor(address: Address, init?: {code: Cell; data: Cell}) {
        super(address, init)
    }

    static async fromInit(totalSupply: bigint, owner: Address, jettonContent: Cell) {
        const base = await JettonMinterFeatureRich.fromInit(totalSupply, owner, jettonContent, true)
        if (base.init === undefined) {
            throw new Error("JettonMinter init is not defined")
        }
        return new ExtendedFeatureRichJettonMinter(base.address, {
            code: base.init.code,
            data: base.init.data,
        })
    }
}
