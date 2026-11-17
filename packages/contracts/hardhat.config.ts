import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const SOLC_VERSION = "0.8.24";

// Use the solc-js compiler from npm instead of downloading from binaries.soliditylang.org.
// Some build/CI environments (and some networks in Iran) cannot reach that host; npm is reachable.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion === SOLC_VERSION) {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: SOLC_VERSION,
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  }
  return runSuper();
});

function firstUrl(list: string, legacy: string): string {
  return (process.env[list] ?? process.env[legacy] ?? "").split(",")[0].trim() || "http://127.0.0.1:8545";
}

const accounts = process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC_VERSION,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    // RPC endpoints: comma-separated lists in .env, used with failover by scripts/lib/rpc.ts (decision D6).
    // Hardhat itself only needs one URL; the scripts open their own multi-provider connection.
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    amoy: {
      url: firstUrl("AMOY_RPC_URLS", "AMOY_RPC_URL"),
      chainId: 80002,
      accounts,
    },
    // Polygon PoS mainnet — deploy only after audit and the Amoy pilot dry run.
    polygon: {
      url: firstUrl("POLYGON_RPC_URLS", "POLYGON_RPC_URL"),
      chainId: 137,
      accounts,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
  },
};

export default config;
