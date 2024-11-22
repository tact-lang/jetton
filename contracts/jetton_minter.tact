import "@stdlib/ownable";
import "./jetton_wallet";
import "./messages";

asm fun emptyAddress(): Address {b{00} PUSHSLICE}

struct JettonMasterState {
    totalSupply: Int as coins;
    mintable: Bool;
    adminAddress: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;
}

contract JettonMinter with OwnableTransferable {
    totalSupply: Int as coins;
    mintable: Bool;
    owner: Address;
    jettonContent: Cell;
    jettonWalletCode: Cell;

    init(owner: Address, jettonContent: Cell) {
        self.totalSupply = 0;
        self.mintable = true;
        self.owner = owner;
        self.jettonContent = jettonContent;
        self.jettonWalletCode = initOf JettonWallet(self.owner, myAddress()).code;
    }

    receive(msg: TokenBurnNotification) {
        //Check that the message is from msg.sender's jetton_wallet
        require(sender() == self.getJettonWalletByOwner(msg.sender), "Not wallet owner");

        self.totalSupply -= msg.amount;
        if (msg.response_destination != null) {
            send(SendParameters{
            to: msg.response_destination!!,
            value: 0,
            bounce: false,
            mode: SendRemainingValue,
            body: TokenExcesses{
            query_id: msg.query_id
            }.toCell()
            });
        }
    }

    receive(msg: TokenUpdateContent){
        self.requireOwner(); // Allow changing content only by owner
        self.jettonContent = msg.content; // Update content
    }

    // https://github.com/ton-blockchain/TEPs/blob/master/text/0089-jetton-wallet-discovery.md
    receive(msg: ProvideWalletAddress) {
        require(context().value >= ton("0.0061"), "Insufficient gas");
        let includedAddress: Address? = null;
        let workchain: Int = parseStdAddress(msg.owner_address.asSlice()).workchain;
        //Note, that emptyAddress != null, it is different values.
        //We do like that according to TEP above
        let targetJettonWallet: Address = emptyAddress();

        //Here was no such check in Howard's code
        if(workchain == 0) { //Only in this case (address is from basechain) we can calculate the address
            targetJettonWallet = contractAddress(initOf JettonWallet(msg.owner_address, myAddress()));
        }
        if (msg.include_address) {
            includedAddress = msg.owner_address;
        }
        send(SendParameters{
        to: sender(),
        value: 0,
        mode: SendRemainingValue,
        body: TakeWalletAddress{
        query_id: msg.query_id,
        wallet_address: targetJettonWallet,
        owner_address: includedAddress
        }.toCell()
        });
    }
    receive(msg: Mint) {
        self.requireOwner(); // Allow minting only by owner
        require(self.mintable, "Not mintable");
        //Maybe we should check that msg.value is enough to cover the gas fees
        //Or, maybe we should do self.totalSupply -= msg.amount if bounced.
        //But there is no any check in Howard's code and in official funC code,
        self.totalSupply += msg.amount; // Update total supply

        let winit: StateInit = self.getJettonWalletInit(msg.receiver);

        send(SendParameters{
        to: contractAddress(winit),
        value: 0,
        bounce: true,
        mode: SendRemainingValue,
        body: TokenTransferInternal{
        query_id: 0,
        amount: msg.amount,
        from: myAddress(),
        response_destination: self.owner, // Owner is minting, so send excess to owner
        forward_ton_amount: 0,
        forward_payload: emptySlice()
        }.toCell(),
        code: winit.code,
        data: winit.data
        });
    }

    fun getJettonWalletByOwner(jetton_wallet_owner: Address): Address {
        let ctx: Context = context();
        let jwInit: StateInit = self.getJettonWalletInit(jetton_wallet_owner);
        return contractAddress(jwInit);
    }

    fun getJettonWalletInit(address: Address): StateInit {
        return initOf JettonWallet(address, myAddress());
    }

    get fun get_jetton_data(): JettonMasterState {
        return JettonMasterState {
        totalSupply: self.totalSupply,
        mintable: self.mintable,
        adminAddress: self.owner,
        jettonContent: self.jettonContent,
        jettonWalletCode: self.jettonWalletCode
        }
    }
    get fun get_wallet_address(ownerAddress: Address): Address {
        return self.getJettonWalletByOwner(ownerAddress);
    }
}