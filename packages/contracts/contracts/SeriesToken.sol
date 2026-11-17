// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title SeriesToken
/// @notice One ERC-20 per issuance series. 1 token = 1 unit of a fixed-return note (0 decimals).
///         Money never moves on-chain: this contract is the public, verifiable record of
///         who holds how many units of which series, and of the series terms (termsHash).
///
/// Roles
/// - DEFAULT_ADMIN_ROLE  platform Safe multisig: role admin, pause, forcedTransfer, enable transfers.
/// - MINTER_ROLE         platform operator key: mint at issuance.
/// - BURNER_ROLE         platform operator key: burn at redemption / default distribution.
/// - FREEZER_ROLE        platform operator key: compliance freeze / unfreeze.
///
/// Rules
/// - Mint: only to a verified identity that is not frozen; total supply never exceeds maxSupply.
/// - Holder-to-holder transfers revert until transfersEnabled (secondary market, Phase 3).
///   When enabled: sender and receiver must not be frozen; receiver must be verified.
/// - Burn: always allowed for BURNER_ROLE (so payouts complete even for frozen holders).
/// - forcedTransfer: admin-only legal correction; ignores the transfer switch and a frozen sender,
///   still requires a verified, non-frozen receiver.
contract SeriesToken is ERC20, ERC20Pausable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 public constant FREEZER_ROLE = keccak256("FREEZER_ROLE");
    uint256 public constant MAX_BATCH = 200;

    IIdentityRegistry public immutable registry;
    bytes32 public immutable seriesIdHash;
    bytes32 public immutable termsHash;
    uint64 public immutable maturity;
    uint256 public immutable maxSupply;

    bool public transfersEnabled;
    mapping(address => bool) public frozen;

    bool private _forcing;

    event Frozen(address indexed account);
    event Unfrozen(address indexed account);
    event TransfersEnabledSet(bool enabled);
    event ForcedTransfer(address indexed from, address indexed to, uint256 amount, bytes32 reasonHash);

    error ZeroAddress();
    error InvalidParams();
    error MaxSupplyExceeded(uint256 requested, uint256 available);
    error RecipientNotVerified(address account);
    error AccountFrozen(address account);
    error TransfersDisabled();
    error BadBatch();

    constructor(
        string memory name_,
        string memory symbol_,
        IIdentityRegistry registry_,
        bytes32 seriesIdHash_,
        bytes32 termsHash_,
        uint64 maturity_,
        uint256 maxSupply_,
        address admin,
        address operator
    ) ERC20(name_, symbol_) {
        if (address(registry_) == address(0) || admin == address(0) || operator == address(0)) revert ZeroAddress();
        if (seriesIdHash_ == bytes32(0) || termsHash_ == bytes32(0) || maxSupply_ == 0 || maturity_ <= block.timestamp) {
            revert InvalidParams();
        }
        registry = registry_;
        seriesIdHash = seriesIdHash_;
        termsHash = termsHash_;
        maturity = maturity_;
        maxSupply = maxSupply_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, operator);
        _grantRole(BURNER_ROLE, operator);
        _grantRole(FREEZER_ROLE, operator);
    }

    function decimals() public pure override returns (uint8) {
        return 0;
    }

    // ---------------------------------------------------------------- operator actions

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        uint256 available = maxSupply - totalSupply();
        if (amount > available) revert MaxSupplyExceeded(amount, available);
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    /// @notice Issuance in one transaction for many holders (PRD: batches of up to 200).
    function mintBatch(address[] calldata to, uint256[] calldata amounts) external onlyRole(MINTER_ROLE) {
        if (to.length != amounts.length || to.length == 0 || to.length > MAX_BATCH) revert BadBatch();
        uint256 total;
        for (uint256 i; i < amounts.length; ++i) total += amounts[i];
        uint256 available = maxSupply - totalSupply();
        if (total > available) revert MaxSupplyExceeded(total, available);
        for (uint256 i; i < to.length; ++i) _mint(to[i], amounts[i]);
    }

    /// @notice Redemption in one transaction for many holders.
    function burnBatch(address[] calldata from, uint256[] calldata amounts) external onlyRole(BURNER_ROLE) {
        if (from.length != amounts.length || from.length == 0 || from.length > MAX_BATCH) revert BadBatch();
        for (uint256 i; i < from.length; ++i) _burn(from[i], amounts[i]);
    }

    function freeze(address account) external onlyRole(FREEZER_ROLE) {
        frozen[account] = true;
        emit Frozen(account);
    }

    function unfreeze(address account) external onlyRole(FREEZER_ROLE) {
        frozen[account] = false;
        emit Unfrozen(account);
    }

    // ---------------------------------------------------------------- admin (multisig) actions

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setTransfersEnabled(bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        transfersEnabled = enabled;
        emit TransfersEnabledSet(enabled);
    }

    function forcedTransfer(address from, address to, uint256 amount, bytes32 reasonHash)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _forcing = true;
        _transfer(from, to, amount);
        _forcing = false;
        emit ForcedTransfer(from, to, amount, reasonHash);
    }

    // ---------------------------------------------------------------- transfer rules

    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        if (to != address(0)) {
            // mint or transfer: receiver checks
            if (frozen[to]) revert AccountFrozen(to);
            if (!registry.isVerified(to)) revert RecipientNotVerified(to);
            if (from != address(0) && !_forcing) {
                // holder-to-holder transfer
                if (!transfersEnabled) revert TransfersDisabled();
                if (frozen[from]) revert AccountFrozen(from);
            }
        }
        super._update(from, to, value);
    }

    function supportsInterface(bytes4 interfaceId) public view override(AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
