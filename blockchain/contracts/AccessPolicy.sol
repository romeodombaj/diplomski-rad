// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract AccessPolicy is AccessControl {
    bytes32 public constant POLICY_ADMIN_ROLE = keccak256("POLICY_ADMIN_ROLE");

    struct Policy {
        string did;
        string doorCode;
        uint256 startTime;
        uint256 endTime;
        bool active;
        string policyId;
        bytes32 scheduleHash;
    }

    mapping(string => Policy) private policyById;
    mapping(string => string[]) private didPolicyIds;
    mapping(string => string[]) private doorPolicyIds;
    string[] private allPolicyIds;
    uint256 private policyCounter;

    event AccessGranted(
        string policyId,
        string did,
        string doorCode,
        uint256 startTime,
        uint256 endTime,
        bytes32 scheduleHash
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

    function grantAccess(
        string calldata _did,
        string calldata _doorCode,
        uint256 _startTime,
        uint256 _endTime,
        bytes32 _scheduleHash
    ) external onlyRole(POLICY_ADMIN_ROLE) returns (string memory) {
        if (bytes(_did).length == 0 || bytes(_doorCode).length == 0) revert EmptyField();
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
            policyId: policyId,
            scheduleHash: _scheduleHash
        });
        didPolicyIds[_did].push(policyId);
        doorPolicyIds[_doorCode].push(policyId);
        allPolicyIds.push(policyId);

        emit AccessGranted(policyId, _did, _doorCode, _startTime, _endTime, _scheduleHash);
        return policyId;
    }

    function revokeAccess(string calldata _policyId) external onlyRole(POLICY_ADMIN_ROLE) {
        Policy storage p = policyById[_policyId];
        if (bytes(p.policyId).length == 0) revert PolicyNotFound(_policyId);
        if (!p.active) revert PolicyAlreadyRevoked(_policyId);

        p.active = false;
        emit AccessRevoked(_policyId, p.did, p.doorCode);
    }

    function hasAccess(string calldata _did, string calldata _doorCode)
        external
        view
        returns (bool)
    {
        string[] memory ids = didPolicyIds[_did];
        for (uint256 i = 0; i < ids.length; i++) {
            if (_active(policyById[ids[i]], _doorCode)) return true;
        }
        return false;
    }

    function hasAccessWithSchedule(string calldata _did, string calldata _doorCode)
        external
        view
        returns (bool allowed, bytes32 scheduleHash)
    {
        string[] memory ids = didPolicyIds[_did];
        bytes32 firstScheduled;
        bool found;
        for (uint256 i = 0; i < ids.length; i++) {
            Policy memory p = policyById[ids[i]];
            if (!_active(p, _doorCode)) continue;
            if (p.scheduleHash == bytes32(0)) return (true, bytes32(0));
            if (!found) {
                firstScheduled = p.scheduleHash;
                found = true;
            }
        }
        return found ? (true, firstScheduled) : (false, bytes32(0));
    }

    function _active(Policy memory p, string calldata _doorCode) private view returns (bool) {
        if (!p.active) return false;
        if (!_eq(p.doorCode, _doorCode)) return false;
        if (block.timestamp < p.startTime) return false;
        if (p.endTime != 0 && block.timestamp > p.endTime) return false;
        return true;
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
