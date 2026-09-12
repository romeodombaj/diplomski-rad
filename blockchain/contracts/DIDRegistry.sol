// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract DIDRegistry is AccessControl {
    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");

    mapping(string => bytes) private didToPublicKey;
    mapping(string => uint256) private didToRegisteredAt;
    string[] private registeredDIDs;

    event DIDRegistered(string indexed didHash, string did, bytes publicKey, uint256 timestamp);

    error DIDAlreadyRegistered(string did);
    error DIDNotRegistered(string did);
    error EmptyDID();
    error EmptyPublicKey();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BACKEND_ROLE, admin);
    }

    function registerDID(string calldata _did, bytes calldata _publicKey)
        external
        onlyRole(BACKEND_ROLE)
    {
        if (bytes(_did).length == 0) revert EmptyDID();
        if (_publicKey.length == 0) revert EmptyPublicKey();
        if (didToPublicKey[_did].length != 0) revert DIDAlreadyRegistered(_did);

        didToPublicKey[_did] = _publicKey;
        didToRegisteredAt[_did] = block.timestamp;
        registeredDIDs.push(_did);

        emit DIDRegistered(_did, _did, _publicKey, block.timestamp);
    }

    function getPublicKey(string calldata _did) external view returns (bytes memory) {
        if (didToPublicKey[_did].length == 0) revert DIDNotRegistered(_did);
        return didToPublicKey[_did];
    }

    function isRegistered(string calldata _did) external view returns (bool) {
        return didToPublicKey[_did].length != 0;
    }

    function getRegistrationTime(string calldata _did) external view returns (uint256) {
        if (didToPublicKey[_did].length == 0) revert DIDNotRegistered(_did);
        return didToRegisteredAt[_did];
    }

    function getRegisteredDIDCount() external view returns (uint256) {
        return registeredDIDs.length;
    }

    function getRegisteredDIDs(uint256 _start, uint256 _count)
        external
        view
        returns (string[] memory)
    {
        uint256 total = registeredDIDs.length;
        if (_start >= total) return new string[](0);
        uint256 end = _start + _count;
        if (end > total) end = total;

        string[] memory page = new string[](end - _start);
        for (uint256 i = _start; i < end; i++) {
            page[i - _start] = registeredDIDs[i];
        }
        return page;
    }
}
