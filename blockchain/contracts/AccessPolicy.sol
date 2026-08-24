// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title AccessPolicy
 * @notice Which DID may open which door, and when.
 *
 * This is the contract that makes the system's central claim true: a building
 * operator cannot quietly grant themselves access at 3am and erase the record,
 * because granting is a transaction on a chain they do not control.
 *
 * ACCESS CONTROL (addresses AUDIT.md F-23):
 * Only POLICY_ADMIN_ROLE may grant or revoke. hasAccess() is an open view --
 * it is called by every backend on every unlock and must stay free and fast.
 */
contract AccessPolicy is AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    struct Policy {
        string did;
        string doorCode;
        uint256 startTime;
        uint256 endTime;
        bool active;
        string policyId;
    }

    mapping(string => Policy) private policyById;
    mapping(string => string[]) private didPolicyIds;
    mapping(string => string[]) private doorPolicyIds;
    string[] private allPolicyIds;
    uint256 private policyCounter;

    event AccessGranted(
        string policyId, string did, string doorCode, uint256 startTime, uint256 endTime
    );
    event AccessRevoked(string policyId, string did, string doorCode);

    error PolicyNotFound(string policyId);
    error PolicyAlreadyRevoked(string policyId);
    error InvalidTimeWindow(uint256 startTime, uint256 endTime);
    error EmptyField();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(POLICY_ADMIN_ROLE, admin);
    }

    function _eq(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /**
     * @notice Grant a DID access to a door for a time window.
     * @param _endTime Absolute unix timestamp, or 0 for "never expires".
     * @return policyId Deterministic id ("pol-N") used to revoke later.
     */
    function grantAccess(
        string calldata _did,
        string calldata _doorCode,
        uint256 _startTime,
        uint256 _endTime
    ) external onlyRole(POLICY_ADMIN_ROLE) returns (string memory) {
        if (bytes(_did).length == 0 || bytes(_doorCode).length == 0) revert EmptyField();
        // endTime == 0 is the sentinel for no expiry; any other value must be
        // after the start, otherwise the policy could never match.
        if (_endTime != 0 && _endTime <= _startTime) {
            revert InvalidTimeWindow(_startTime, _endTime);
        }

        policyCounter++;
        string memory policyId = string.concat("pol-", Strings.toString(policyCounter));

        policyById[policyId] = Policy({
            did: _did,
            doorCode: _doorCode,
            startTime: _startTime,
            endTime: _endTime,
            active: true,
            policyId: policyId
        });
        didPolicyIds[_did].push(policyId);
        doorPolicyIds[_doorCode].push(policyId);
        allPolicyIds.push(policyId);

        emit AccessGranted(policyId, _did, _doorCode, _startTime, _endTime);
        return policyId;
    }

    /**
     * @dev Deactivates rather than deletes. The policy stays readable so an
     *      auditor can still see that access once existed and when it ended --
     *      deleting it would recreate exactly the "silently modified history"
     *      problem the chain is here to prevent.
     */
    function revokeAccess(string calldata _policyId) external onlyRole(POLICY_ADMIN_ROLE) {
        Policy storage p = policyById[_policyId];
        if (bytes(p.policyId).length == 0) revert PolicyNotFound(_policyId);
        if (!p.active) revert PolicyAlreadyRevoked(_policyId);

        p.active = false;
        emit AccessRevoked(_policyId, p.did, p.doorCode);
    }

    /**
     * @notice Is this DID allowed through this door right now?
     * @dev Scans the DID's own policies only, so cost grows with policies per
     *      user (small) rather than policies in the system (large). It is a
     *      view, so this costs the caller nothing.
     */
    function hasAccess(string calldata _did, string calldata _doorCode)
        external
        view
        returns (bool)
    {
        string[] memory ids = didPolicyIds[_did];
        for (uint256 i = 0; i < ids.length; i++) {
            Policy memory p = policyById[ids[i]];
            if (!p.active) continue;
            if (!_eq(p.doorCode, _doorCode)) continue;
            if (block.timestamp < p.startTime) continue;
            if (p.endTime != 0 && block.timestamp > p.endTime) continue;
            return true;
        }
        return false;
    }

    function getPolicy(string calldata _policyId) external view returns (Policy memory) {
        Policy memory p = policyById[_policyId];
        if (bytes(p.policyId).length == 0) revert PolicyNotFound(_policyId);
        return p;
    }

    function getPoliciesForDID(string calldata _did) external view returns (Policy[] memory) {
        return _collect(didPolicyIds[_did]);
    }

    function getPoliciesForDoor(string calldata _doorCode)
        external
        view
        returns (Policy[] memory)
    {
        return _collect(doorPolicyIds[_doorCode]);
    }

    function getPolicyCount() external view returns (uint256) {
        return allPolicyIds.length;
    }

    function _collect(string[] memory ids) private view returns (Policy[] memory) {
        Policy[] memory out = new Policy[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            out[i] = policyById[ids[i]];
        }
        return out;
    }
}
