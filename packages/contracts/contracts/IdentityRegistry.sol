// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IIdentityRegistry} from "./interfaces/IIdentityRegistry.sol";

/// @title IdentityRegistry
/// @notice Registry of verified organisation wallets (custodial addresses).
///         - DEFAULT_ADMIN_ROLE: platform Safe multisig (role management only).
///         - REGISTRAR_ROLE: platform operator key (register / update / revoke on KYB events).
contract IdentityRegistry is AccessControl, IIdentityRegistry {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    uint8 public constant FLAG_INVESTOR = 1;
    uint8 public constant FLAG_ISSUER = 2;
    uint8 public constant FLAG_FUND = 4;

    mapping(address => Identity) private _identities;

    error ZeroAddress();
    error AlreadyRegistered(address wallet);
    error NotRegistered(address wallet);
    error ExpiryInPast(uint64 expiry);
    error EmptyHash();
    error NotRevoked(address wallet);

    constructor(address admin, address registrar) {
        if (admin == address(0) || registrar == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE, registrar);
    }

    function register(address wallet, bytes32 orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        if (wallet == address(0)) revert ZeroAddress();
        if (_identities[wallet].exists) revert AlreadyRegistered(wallet);
        if (orgIdHash == bytes32(0) || kybHash == bytes32(0)) revert EmptyHash();
        if (expiry <= block.timestamp) revert ExpiryInPast(expiry);

        _identities[wallet] = Identity({
            orgIdHash: orgIdHash,
            kybHash: kybHash,
            expiry: expiry,
            flags: flags,
            revoked: false,
            exists: true
        });
        emit IdentityRegistered(wallet, orgIdHash, flags, kybHash, expiry);
    }

    /// @notice Refresh flags / KYB snapshot / expiry (e.g. re-KYB). Does not lift a revocation.
    function update(address wallet, uint8 flags, bytes32 kybHash, uint64 expiry) external onlyRole(REGISTRAR_ROLE) {
        Identity storage id = _identities[wallet];
        if (!id.exists) revert NotRegistered(wallet);
        if (kybHash == bytes32(0)) revert EmptyHash();
        if (expiry <= block.timestamp) revert ExpiryInPast(expiry);
        id.flags = flags;
        id.kybHash = kybHash;
        id.expiry = expiry;
        emit IdentityUpdated(wallet, flags, kybHash, expiry);
    }

    /// @notice Block an identity (compliance freeze, KYB expired, org closed). Holdings stay; new mints are refused.
    function revoke(address wallet) external onlyRole(REGISTRAR_ROLE) {
        Identity storage id = _identities[wallet];
        if (!id.exists) revert NotRegistered(wallet);
        id.revoked = true;
        emit IdentityRevoked(wallet);
    }

    function reinstate(address wallet) external onlyRole(REGISTRAR_ROLE) {
        Identity storage id = _identities[wallet];
        if (!id.exists) revert NotRegistered(wallet);
        if (!id.revoked) revert NotRevoked(wallet);
        id.revoked = false;
        emit IdentityReinstated(wallet);
    }

    function isVerified(address wallet) external view returns (bool) {
        Identity storage id = _identities[wallet];
        return id.exists && !id.revoked && id.expiry > block.timestamp;
    }

    function identityOf(address wallet) external view returns (Identity memory) {
        return _identities[wallet];
    }
}
