// Gas constants
const SendTransferGasConsumption: Int = 9255;
const ReceiveTransferGasConsumption: Int = 10355;

const SendBurnGasConsumption: Int = 6187;
const ReceiveBurnGasConsumption: Int = 6960;


const MyWorkchain: Bool = false;
// Storage constants
const WalletStateInitSizeCells: Int = 16;
const WalletStateInitSizeBits: Int = 10000;
const MinStorageDuration: Int = 5 * 365 * 24 * 3600; // 5 years

const BurnNotificationCells: Int = 1;
const BurnNotificationBits: Int = 800;