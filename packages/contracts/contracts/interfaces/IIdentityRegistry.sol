// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

/// @title IIdentityRegistry
/// @notice On-chain "digital ID" for platform organisations. Holds no personal data:
///         only hashes and an expiry. The off-chain platform (KYB) is the source of truth.
interface IIdentityRegistry {
    struct Identity {
        bytes32 orgIdHash; // keccak256(org.id || platform salt)
        bytes32 kybHash; // hash of the approved KYB case snapshot
        uint64 expiry; // unix seconds; identity is invalid after this
        uint8 flags; // bitmask: FLAG_INVESTOR | FLAG_ISSUER | FLAG_FUND
        bool revoked;
        bool exists;
    }

    event IdentityRegistered(address indexed wallet, bytes32 indexed orgIdHash, uint8 flags, bytes32 kybHash, uint64 expiry);
    event IdentityUpdated(address indexed wallet, uint8 flags, bytes32 kybHash, uint64 expiry);
    event IdentityRevoked(address indexed wallet);
    event IdentityReinstated(address indexed wallet);

    function isVerified(address wallet) external view returns (bool);

    function identityOf(address wallet) external view returns (Identity memory);
}
