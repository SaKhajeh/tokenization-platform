// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";
import {SeriesToken} from "./SeriesToken.sol";

/// @title SeriesFactory
/// @notice Deploys one SeriesToken per approved series from a single audited template,
///         so every issuer gets exactly the same rules.
///         - DEFAULT_ADMIN_ROLE: platform Safe multisig (may change tokenAdmin / tokenOperator).
///         - DEPLOYER_ROLE: platform operator key, called after the fund + two platform approvals (off-chain).
contract SeriesFactory is AccessControl {
    bytes32 public constant DEPLOYER_ROLE = keccak256("DEPLOYER_ROLE");

    IIdentityRegistry public immutable registry;
    address public tokenAdmin; // receives DEFAULT_ADMIN_ROLE on each new token (Safe multisig)
    address public tokenOperator; // receives MINTER/BURNER/FREEZER on each new token

    mapping(bytes32 => address) public seriesOf; // seriesIdHash => token
    address[] private _allSeries;

    event SeriesCreated(
        address indexed token, bytes32 indexed seriesIdHash, bytes32 termsHash, uint64 maturity, uint256 maxSupply
    );
    event TokenRolesSet(address tokenAdmin, address tokenOperator);

    error ZeroAddress();
    error SeriesExists(bytes32 seriesIdHash, address token);

    constructor(IIdentityRegistry registry_, address admin, address deployer, address tokenAdmin_, address tokenOperator_) {
        if (
            address(registry_) == address(0) || admin == address(0) || deployer == address(0)
                || tokenAdmin_ == address(0) || tokenOperator_ == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        tokenAdmin = tokenAdmin_;
        tokenOperator = tokenOperator_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(DEPLOYER_ROLE, deployer);
        emit TokenRolesSet(tokenAdmin_, tokenOperator_);
    }

    function createSeries(
        string calldata name,
        string calldata symbol,
        bytes32 seriesIdHash,
        bytes32 termsHash,
        uint64 maturity,
        uint256 maxSupply
    ) external onlyRole(DEPLOYER_ROLE) returns (address token) {
        address existing = seriesOf[seriesIdHash];
        if (existing != address(0)) revert SeriesExists(seriesIdHash, existing);

        token = address(
            new SeriesToken(name, symbol, registry, seriesIdHash, termsHash, maturity, maxSupply, tokenAdmin, tokenOperator)
        );
        seriesOf[seriesIdHash] = token;
        _allSeries.push(token);
        emit SeriesCreated(token, seriesIdHash, termsHash, maturity, maxSupply);
    }

    function setTokenRoles(address tokenAdmin_, address tokenOperator_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tokenAdmin_ == address(0) || tokenOperator_ == address(0)) revert ZeroAddress();
        tokenAdmin = tokenAdmin_;
        tokenOperator = tokenOperator_;
        emit TokenRolesSet(tokenAdmin_, tokenOperator_);
    }

    function seriesCount() external view returns (uint256) {
        return _allSeries.length;
    }

    function seriesAt(uint256 index) external view returns (address) {
        return _allSeries[index];
    }
}
