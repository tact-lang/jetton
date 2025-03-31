// Gas constants
const SendTransferGasConsumption: Int = 9520;
const ReceiveTransferGasConsumption: Int = 10234;

const SendBurnGasConsumption: Int = 6205;
const ReceiveBurnGasConsumption: Int = 6960;


const MyWorkchain: Bool = false;
// Storage constants
const WalletSizeCells: Int = 3;
const WalletSizeBits: Int = 1033;

const WalletStateInitSizeCells: Int = 3;
const WalletStateInitSizeBits: Int = 931;

const RealWalletStateInitSizeCells: Int = 24;
const RealWalletStateInitSizeBits: Int = 10899;
const MinStorageDuration: Int = 5 * 365 * 24 * 3600; // 5 years

const BurnNotificationCells: Int = 1;
const BurnNotificationBits: Int = 754;