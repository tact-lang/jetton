import "./messages";
import "./constants";

asm fun myCode(): Cell { MYCODE }

fun force_chain(addr: Slice) {
  nativeThrowUnless(333, parseStdAddress(addr).workchain == 0);
}

//This contract also has Ownable functionality, but it is implemented without Ownable trait
//to match refference implementation in terms of exit codes.
contract JettonWallet with WalletExitcodes, GasConstants {
    balance: Int as coins;
    owner: Address;
    master: Address;
    const minTonsForStorage: Int = ton("0.015"); // 0.01 TON in original funC implementation. Increased as we have approx. x2 code size
    const gasConsumption: Int = ton("0.015"); // 0.015 TON in original funC implementation.
    // According to tests, 23k gas is maximum gas consuption in transfer. 23k gas is 0.0092 TON
    // More precisely, max gas I could get is 22725
    init(owner: Address, master: Address) {
        self.balance = 0;
        self.owner = owner;
        self.master = master;
    }
    fun send_tokens(in_msg_body: Slice, sender_address: Slice, msg_value: Int, fwd_fee: Int) {
        let query_id = in_msg_body.loadUint(64);
        let jetton_amount = in_msg_body.loadCoins();
        let to_owner_address = in_msg_body.loadAddress();
        force_chain(to_owner_address.asSlice());
        self.balance -= jetton_amount;

        nativeThrowUnless(705, (self.owner.asSlice() == sender_address));
        nativeThrowUnless(706, self.balance >= 0);

        let state_init = calculate_jetton_wallet_state_init(to_owner_address.asSlice(), self.master.asSlice(), myCode());
        let to_wallet_address = calculate_jetton_wallet_address(state_init);
        let response_address = in_msg_body.loadAddress();
        let custom_payload = in_msg_body.loadBool();
        let forward_ton_amount = in_msg_body.loadCoins();
        nativeThrowUnless(708, in_msg_body.bits() >= 1);
        let either_forward_payload = in_msg_body;
        let msg = beginCell()
            .storeUint(0x18, 6)
            .storeSlice(to_wallet_address)
            .storeCoins(0)
            .storeUint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
            .storeRef(state_init);
        let msg_body = beginCell()
            .storeUint(internal_transfer(), 32)
            .storeUint(query_id, 64)
            .storeCoins(jetton_amount)
            .storeSlice(self.owner.asSlice())
            .storeSlice(response_address.asSlice())
            .storeCoins(forward_ton_amount)
            .storeSlice(either_forward_payload)
            .endCell();

        msg = msg.storeRef(msg_body);
        let fwd_count = forward_ton_amount != 0 ? 2 : 1;
        nativeThrowUnless(709, msg_value >
                            forward_ton_amount +
                            
                            
                            fwd_count * fwd_fee +
                            (2 * ton("0.015") + self.minTonsForStorage));
                            
                            
                            

        nativeSendMessage(msg.endCell(), 64); 
    }


    fun receive_tokens (in_msg_body: Slice, sender_address: Slice, my_ton_balance: Int, fwd_fee: Int, msg_value: Int) {
        let query_id = in_msg_body.loadUint(64);
        let jetton_amount = in_msg_body.loadCoins();
        self.balance += jetton_amount;
        let from_address = in_msg_body.loadAddress();
        let response_address = in_msg_body.loadAddress();
        nativeThrowUnless(707,
            (self.master.asSlice() == sender_address)
            ||
            (calculate_user_jetton_wallet_address(from_address.asSlice(), self.master.asSlice(), myCode()) == sender_address)
        );
        let forward_ton_amount = in_msg_body.loadCoins();

        let ton_balance_before_msg = my_ton_balance - msg_value;
        let storage_fee = self.minTonsForStorage - min(ton_balance_before_msg, ton("0.015"));
        msg_value -= (storage_fee + self.gasConsumption);
        if(forward_ton_amount > 0) {
            msg_value -= (forward_ton_amount + fwd_fee);
            let either_forward_payload = in_msg_body;

            let msg_body = beginCell()
                .storeUint(transfer_notification(), 32)
                .storeUint(query_id, 64)
                .storeCoins(jetton_amount)
                .storeSlice(from_address.asSlice())
                .storeSlice(either_forward_payload)
                .endCell();

            let msg = beginCell()
            .storeUint(0x10, 6) 
            .storeSlice(self.owner.asSlice())
            .storeCoins(forward_ton_amount)
            .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .storeRef(msg_body);

            nativeSendMessage(msg.endCell(), 1);
        }

        if ((response_address.asSlice().preloadUint(2) != 0) && (msg_value > 0)) {
            let msg = beginCell()
            .storeUint(0x10, 6) 
            .storeSlice(response_address.asSlice())
            .storeCoins(msg_value)
            .storeUint(0, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .storeUint(excesses(), 32)
            .storeUint(query_id, 64);
            nativeSendMessage(msg.endCell(), 2);
        }
    }

        fun burn_tokens (in_msg_body: Slice, sender_address: Slice, msg_value: Int, fwd_fee: Int) {
        let query_id = in_msg_body.loadUint(64);
        let jetton_amount = in_msg_body.loadCoins();
        let response_address = in_msg_body.loadAddress();
        self.balance -= jetton_amount;
        nativeThrowUnless(705, self.owner.asSlice() == sender_address);
        nativeThrowUnless(706, self.balance >= 0);
        nativeThrowUnless(707, msg_value > fwd_fee + 2 * ton("0.015"));

        let msg_body = beginCell()
            .storeUint(burn_notification(), 32)
            .storeUint(query_id, 64)
            .storeCoins(jetton_amount)
            .storeSlice(self.owner.asSlice())
            .storeSlice(response_address.asSlice())
            .endCell();

        let msg = beginCell()
            .storeUint(0x18, 6)
            .storeSlice(self.master.asSlice())
            .storeCoins(0)
            .storeUint(1, 1 + 4 + 4 + 64 + 32 + 1 + 1)
            .storeRef(msg_body);

        nativeSendMessage(msg.endCell(), 64);
    }

    receive(msg: Slice) {
        if (msg.bits() == 0) { 
            return;
        }

        let fwd_fee = context().readForwardFee();

        let op = msg.loadUint(32);

        if (op == transfer()) { 
            self.send_tokens(msg, sender().asSlice(), context().value, fwd_fee);
            return;
        }

        if (op == internal_transfer()) { 
            self.receive_tokens(msg, sender().asSlice(), myBalance(), fwd_fee, context().value);
            return;
        }

        if (op == burn()) { 
            self.burn_tokens(msg, sender().asSlice(), context().value, fwd_fee);
            return;
        }

        nativeThrow(0xffff);
    }

    bounced(msg: bounced<TokenTransferInternal>){
        self.balance += msg.amount;
    }

    bounced(msg: bounced<TokenBurnNotification>){
        self.balance += msg.amount;
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData{
            balance: self.balance,
            owner: self.owner,
            master: self.master,
            code: myCode() //may be replaced with "initOf JettonDefaultWallet(self.owner, self.master).code"
        };
    }
}
