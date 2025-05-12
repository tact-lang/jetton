import "./messages";
import "./constants";

struct ShardDeployParameters {
    /// An 8-bit value that configures how to send a message, defaults to 0.
    /// See: https://docs.tact-lang.org/book/message-mode
    mode: Int = SendDefaultMode;

    /// Optional message body as a `Cell`.
    body: Cell;

    /// The amount of nanoToncoins you want to send with
    /// the message. This value is used to cover forward fees,
    /// unless the optional flag `SendPayGasSeparately` is used.
    value: Int;

    /// When set to `true` (default) message bounces back to the sender if
    /// the recipient contract doesn't exist or wasn't able to process the message.
    bounce: Bool = true;

    /// Initial package of the contract (initial code and initial data).
    /// See: https://docs.tact-lang.org/book/expressions#initof
    init: StateInit;

    shard: Int as uint30;
}

fun shardDeploy(params: ShardDeployParameters) {
    let newStateInit = beginCell()
        .storeUint(1, 1)
        .storeUint(prefix_length, 5)
        .storeUint(0, 1)
        .storeMaybeRef(params.init.code)
        .storeMaybeRef(params.init.data)
        .storeUint(0, 1)
        .endCell();

    let expectedAddr = beginCell()
        .storeUint(4, 3)
        .storeUint(0, 8)
        .storeUint((newStateInit.hash() & ((1 << (256 - prefix_length)) - 1)) | (params.shard << (256 - prefix_length)), 256) // 
        .asSlice();

    let parsedAddr = parseStdAddress(expectedAddr);
    let realAddr = beginCell()
        .storeUint(4, 3)
        .storeUint(0, 8)
        .storeUint(parsedAddr.address, 256) // First 32 bits of address will be 0
        .asSlice();

    let msg = beginCell()
        .storeUint(0x18, 6)
        .storeSlice(realAddr)
        .storeCoins(0)
        .storeUint(4 + 2 + 1, 1 + 4 + 4 + 64 + 32 + 1 + 1 + 1)
        .storeRef(newStateInit)
        .storeRef(params.body)
        .endCell();

    sendRawMessage(msg, params.mode);
}


fun initToPrefixInit(init: StateInit): Cell {        
    let newStateInit = beginCell()
        .storeUint(1, 1)
        .storeUint(prefix_length, 5)
        .storeUint(0, 1)
        .storeMaybeRef(init.code)
        .storeMaybeRef(init.data)
        .storeUint(0, 1)
        .endCell();
    return newStateInit;
}

inline fun contractBasechainAddressPrefix(s: StateInit): BasechainAddress {
    let hash = initToPrefixInit(s).hash();
    return newBasechainAddress(hash);
}


inline extends fun hasSameBasechainAddressPrefix(self: StateInit, sender: Address): Bool {
    let senderAddress = parseStdAddress(sender.asSlice()).address;
    let baseAddress = contractBasechainAddressPrefix(self);
    return (baseAddress.hash!! & ((1 << (256 - prefix_length)) - 1)) == (senderAddress & ((1 << (256 - prefix_length)) - 1));
}

contract JettonWallet(
    owner: Address,
    minter: Address,
    balance: Int as coins,
) {
    receive(msg: JettonTransfer) {
        forceBasechain(msg.destination);
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");
        checkEitherForwardPayload(msg.forwardPayload);

        let ctx = context();
        let fwdCount = 1 + sign(msg.forwardTonAmount); // msg.forwardTonAmount is coins, so it's positive
        require(
            ctx.value >
            msg.forwardTonAmount +
            fwdCount * ctx.readForwardFee() +
            (2 * getComputeFee(gasForTransfer, false) + minTonsForStorage),
            "Insufficient amount of TON attached",
        );

        shardDeploy(ShardDeployParameters{
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonTransferInternal {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
                forwardTonAmount: msg.forwardTonAmount,
                forwardPayload: msg.forwardPayload,
            }.toCell(),
            init: initOf JettonWallet(msg.destination, self.minter, 0),
            shard: sender().asSlice().loadUint(prefix_length),
        });
    }

    receive(msg: JettonTransferInternal) {
        self.balance += msg.amount;

        // This message should come only from master, or from other JettonWallet
        let wallet: StateInit = initOf JettonWallet(msg.sender, self.minter, 0);
        if (!wallet.hasSameBasechainAddressPrefix(sender())) {
            require(self.minter == sender(), "Incorrect sender");
        }
        let ctx: Context = context();
        let msgValue: Int = ctx.value;
        let tonBalanceBeforeMsg = myBalance() - msgValue;

        if (msg.forwardTonAmount > 0) {
            let fwdFee: Int = ctx.readForwardFee();
            msgValue -= msg.forwardTonAmount + fwdFee;
            message(MessageParameters {
                to: self.owner,
                value: msg.forwardTonAmount,
                mode: SendPayGasSeparately,
                bounce: false,
                body: JettonNotification { // 0x7362d09c -- Remind the new Owner
                    queryId: msg.queryId,
                    amount: msg.amount,
                    sender: msg.sender,
                    forwardPayload: msg.forwardPayload,
                }.toCell(),
            });
        }
        nativeReserve(max(tonBalanceBeforeMsg, minTonsForStorage), ReserveAtMost);
        // 0xd53276db -- Cashback to the original Sender
        if (msg.responseDestination != null && msgValue > 0){
            message(MessageParameters {
                to: msg.responseDestination!!,
                value: msgValue,
                mode: SendRemainingBalance + SendIgnoreErrors,
                bounce: false,
                body: JettonExcesses { queryId: msg.queryId }.toCell(),
            });
        }
    }

    receive(msg: ProvideWalletBalance) {
        let info: VerifyInfo? = null;
        if (msg.includeVerifyInfo) {
            info = VerifyInfo {
                minter: self.minter,
                owner: self.owner,
                code: myCode(),
            };
        }

        message(MessageParameters {
            body: TakeWalletBalance {
                balance: self.balance,
                verifyInfo: info,
            }.toCell(),
            to: msg.receiver,
            value: 0,
            mode: SendRemainingValue,
        });
    }

    receive(msg: JettonBurn) {
        // we can skip forceBasechain here because with other checks in place it's not possible
        // to acquire jettons outside of basechain, so amount check is enough
        require(sender() == self.owner, "Incorrect sender");

        self.balance -= msg.amount;
        require(self.balance >= 0, "Incorrect balance after send");

        let ctx = context();
        let fwdFee: Int = ctx.readForwardFee();
        require(ctx.value > (fwdFee + 2 * getComputeFee(gasForBurn, false)), "Insufficient amount of TON attached");

        message(MessageParameters {
            to: self.minter,
            value: 0,
            mode: SendRemainingValue,
            bounce: true,
            body: JettonBurnNotification {
                queryId: msg.queryId,
                amount: msg.amount,
                sender: self.owner,
                responseDestination: msg.responseDestination,
            }.toCell(),
        });
    }

    receive(msg: ClaimTON) {
        require(sender() == self.owner, "Incorrect sender");
        nativeReserve(minTonsForStorage, ReserveExact | ReserveBounceIfActionFail);

        // we allow bounce here and don't handle it, if claim fails we just accept the TONs back
        message(MessageParameters {
            to: msg.receiver,
            value: 0,
            mode: SendRemainingBalance,
        });
    }

    bounced(msg: bounced<JettonTransferInternal>) {
        self.balance += msg.amount;
    }

    bounced(msg: bounced<JettonBurnNotification>) {
        self.balance += msg.amount;
    }

    get fun get_wallet_data(): JettonWalletData {
        return JettonWalletData {
            balance: self.balance,
            owner: self.owner,
            minter: self.minter,
            code: myCode(),
        };
    }
}
