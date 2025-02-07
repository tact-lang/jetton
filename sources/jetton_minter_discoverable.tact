import "@stdlib/ownable";
import "@stdlib/deploy";
import "./jetton_wallet";
import "./constants";
import "./messages";

asm fun emptyAddress(): Address { b{00} PUSHSLICE }

asm fun provide_wallet_address(): Int { 0x2c76b973 PUSHINT }
asm fun take_wallet_address(): Int { 0xd1735400 PUSHINT }

inline fun is_resolvable(addr: Address): Bool {
    return parseStdAddress(addr.asSlice()).workchain == 0;
}

asm fun getJettonWalletCode(): Cell {
    B{b5ee9c720102100100038d000114ff00f4a413f4bcf2c80b0102016202030268d001d0d3030171b0a301fa4054613013166f04f86102f862db3c4034db3cf2e082c87f01ca0055205afa0258cf1601cf16c9ed540e040201200c0d01c88e5b8020d7217021d749c21f953020d70b1fde208210178d4519ba8e1a30d31f018210178d4519baf2e081d33ffa00596c123113a0027fe082107bdd97deba8e19d31f0182107bdd97debaf2e081d33ffa00596c123113a0027fe0307fe020d749c21f300503f420d749c00091308feff8416f24fa40fa0071d721fa00fa00306c6170f83a01d31f82100f8a7ea55220ba8e8e31f842f8416f24135f035502db3ce08210178d45195220ba8e9431f842f8276f10f8416f24135f0310344130db3ce08210595f07bc12ba8e8df842f8416f24135f035502db3ce05b840ff2f0e27f06070802f603d33ffa00fa400120db3c5192a1515801f90101f901baf2e2c124c2fff2e2c25186f82ac87001cb015210f4007055213032c87001cb0001cf1601cf16c901f4007001cb00c920c87401cb027001ca0701f90001cbffc9d009fa400101d20031fa0020d749c200f2e2c4c8801801cb05500ccf1670fa027701cb6b090a01f404d33ffa005191a009fa400101fa4001537901f90101f901ba92377f8e3f5329f82ac87001cb015210f4007055213032c87001cb0001cf1601cf16c901f4007001cb00c9c87401cb027001ca0701f90001cbffc9d01801f90101f901bae2f2e2c3fa005168a18208e4e1c066b608a18208e4e1c0a018a127c2000b00ae03d33ffa00fa4001315181a1514701f90101f901baf2e2c123c2fff2e2c2048209c9c380a012bcf2e2c3c882107bdd97de01cb1fcb3f58fa0223cf165004cf16c9c8801801cb0522cf1670fa027101cb6accc98040fb000010fa4430c000f2e14d008013ccc88210178d451901cb1f15cb3f5003fa0228cf1658cf1621fa025008cf16c901cc26c30091729171e25004a816a0820aaea540a015bcf2e2c5c98040fb0000e08e365275a014a1c882107362d09c01cb1f5230cb3f58fa025003cf165003cf16c9c8801001cb0527cf165005fa027101cb6a14ccc971fb0094375b6c21e221d70b01c3009322c2009170e28e1fc8801001cb0558cf1658fa027001cb6a8210d53276db01cb1fcb3fc972fb00925f03e20211bfd816d9e6d9e361a40e0f0011be15f76a268690000c0044ed44d0d200019dfa00fa400101fa400143306c13e0fa400101fa40011202d1017059000ef82a5463305230} B>boc PUSHREF
}

struct JettonMasterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

fun mint_tokens(to_address: Address, jetton_wallet_code: Cell, amount: Int, master_msg: Cell) {
    let state_init = calculate_jetton_wallet_state_init(to_address.asSlice(), myAddress().asSlice(), getJettonWalletCode());
    let to_wallet_address = calculate_jetton_wallet_address(state_init);
    let msg = beginCell()
            .storeUint(0x18, 6)
            .storeSlice(to_wallet_address)
            .storeCoins(amount)
            .storeUint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
            .storeRef(state_init)
            .storeRef(master_msg);
    nativeSendMessage(msg.endCell(), 1);
}



asm fun mint(): Int { 21 PUSHINT }
//Actually this contract has OwnableTransferable functionality
//but this logic is implemented without OwnableTransferable trait
//to match refference implementation in terms of exit codes.
contract JettonMinter with MinterExitcodes, GasConstants {
    totalSupply: Int as coins;
    mintable: Bool;
    owner: Address;
    jettonContent: Cell;

    init(owner: Address, jettonContent: Cell) {
        self.totalSupply = 0;
        self.mintable = true;
        self.owner = owner;
        self.jettonContent = jettonContent;
    }

    receive(msg: Slice) {
        if(msg.bits() < 32) {
            return; 
        }
        let fwd_fee = context().readForwardFee(); 

        let op = msg.loadUint(32);
        let query_id = msg.loadUint(64);


        if (op == mint()) {
            nativeThrowUnless(73, sender() == self.owner);
            let to_address = msg.loadAddress();
            let amount = msg.loadCoins();
            let master_msg = msg.loadRef();
            let master_msg_cs = master_msg.beginParse();
            master_msg_cs.skipBits(32 + 64);
            let jetton_amount = master_msg_cs.loadCoins();
            mint_tokens(to_address, getJettonWalletCode(), amount, master_msg);
            self.totalSupply += jetton_amount;
            return;
        }

        if (op == burn_notification()) {
            let jetton_amount = msg.loadCoins();
            let from_address = msg.loadAddress();
            nativeThrowUnless(74,
                    (calculate_user_jetton_wallet_address(from_address.asSlice(), myAddress().asSlice(), getJettonWalletCode()) == sender().asSlice())
            );
            self.totalSupply -= jetton_amount;
            let response_address = msg.loadAddress();
            if (response_address.asSlice().preloadUint(2) != 0) {
                let msgNew = beginCell()
                        .storeUint(0x10, 6) 
                        .storeAddress(response_address)
                        .storeCoins(0)
                        .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                        .storeUint(excesses(), 32)
                        .storeUint(query_id, 64);
                nativeSendMessage(msgNew.endCell(), 2 + 64);
            }
            return;
        }

        if (op == provide_wallet_address()) {
            nativeThrowUnless(75, context().value > context().readForwardFee() + 10000000);

            let owner_address = msg.loadAddress();
            let include_address = msg.loadUint(1);

            let included_address = (include_address != 0)
                    ? beginCell().storeAddress(owner_address).endCell()
                    : null;

            let msgNew = beginCell()
                    .storeUint(0x18, 6)
                    .storeAddress(sender())
                    .storeCoins(0)
                    .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
                    .storeUint(take_wallet_address(), 32)
                    .storeUint(query_id, 64);

            if (is_resolvable(owner_address)) {
                msgNew = msgNew.storeSlice(calculate_user_jetton_wallet_address(owner_address.asSlice(), myAddress().asSlice(), getJettonWalletCode()));
            } else {
                msgNew = msgNew.storeUint(0, 2); 
            }
            nativeSendMessage(msgNew.storeMaybeRef(included_address).endCell(), 64);
            return;
        }

        if (op == 3) { 
            nativeThrowUnless(73, sender() == self.owner);
            let new_admin_address = msg.loadAddress();
            self.owner = new_admin_address;
            return;
        }

        if (op == 4) { 
            nativeThrowUnless(73, sender() == self.owner);
            self.jettonContent = msg.loadRef();
            return;
        }

        nativeThrow(0xffff);
    }

    bounced(msg: bounced<TokenTransferInternal>){
        self.totalSupply -= msg.amount;
    }

    //https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md#scheme
    //take_wallet_address#d1735400 query_id:uint64 wallet_address:MsgAddress owner_address:(Maybe ^MsgAddress) = InternalMsgBody;
    inline fun takeWalletBody(targetJettonWallet: Address, includedAddress: Address?, query_id: Int): Cell {
        let body: Builder = beginCell()
        .storeUint(0xd1735400, 32) // takeWalletBody opcode
        .storeUint(query_id, 64)
        .storeSlice(targetJettonWallet.asSlice());
        if (includedAddress != null) {
            let includedAddressCell: Cell = beginCell().storeSlice(includedAddress!!.asSlice()).endCell();
            body = body.storeBit(true); // Maybe bit
            body = body.storeRef(includedAddressCell);
        } else {
            body = body.storeBit(false); // Maybe bit
        }
        return body.endCell();
    }

    inline fun getJettonWalletByOwner(jetton_wallet_owner: Address): Address {
        let jwInit: StateInit = self.getJettonWalletInit(jetton_wallet_owner);
        return contractAddress(jwInit);
    }

    inline fun getJettonWalletInit(address: Address): StateInit {
        return initOf JettonWallet(address, myAddress());
    }

    get fun get_jetton_data(): JettonMasterState {
        return JettonMasterState {
            totalSupply: self.totalSupply,
            mintable: self.mintable,
            adminAddress: self.owner,
            jettonContent: self.jettonContent,
                                                //Owner may be any address, what matters here is the code, not data.
            jettonWalletCode: initOf JettonWallet(myAddress(), myAddress()).code
        }
    }
    get fun get_wallet_address(ownerAddress: Address): Slice {
        return calculate_user_jetton_wallet_address(ownerAddress.asSlice(), myAddress().asSlice(), getJettonWalletCode());
    }
    get fun owner(): Address {
        return self.owner;
    }
}
