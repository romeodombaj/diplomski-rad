// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AuditLog
 * @notice Append-only log of access-event hashes, plus the DID revocation list.
 *
 * PRIVACY: only the HASH of an access event is stored, never the event itself.
 * Anyone on earth can read this contract forever, so publishing "DID X opened
 * door Y at 03:14" would leak every user's movements permanently. Storing the
 * hash still proves an event happened and was not altered: the backend keeps
 * the detail off-chain and anyone can recompute the hash to verify it matches.
 *
 * There is deliberately no delete or edit function. Append-only is the entire
 * guarantee this contract exists to provide.
 *
 * ACCESS CONTROL (addresses AUDIT.md F-23):
 * BACKEND_ROLE writes events; REVOCATION_ADMIN_ROLE manages the revocation
 * list. Reads are open.
 */
contract AuditLog is AccessControl {
    bytes32 public constant BACKEND_ROLE = keccak256("BACKEND_ROLE");
    bytes32 public constant REVOCATION_ADMIN_ROLE = keccak256("REVOCATION_ADMIN_ROLE");

    struct EventEntry {
        string eventHash;
        string doorCode;
        uint256 timestamp;
    }

    EventEntry[] private events;

    mapping(string => bool) private revokedDIDs;
    string[] private revokedList;
    // 1-based index into revokedList; 0 means "not in the list".
    mapping(string => uint256) private revokedIndex;

    event EventLogged(uint256 indexed index, string eventHash, string doorCode, uint256 timestamp);
    event DIDRevoked(string did, uint256 timestamp);
    event DIDRestored(string did, uint256 timestamp);

    error EmptyField();
    error AlreadyRevoked(string did);
    error NotRevoked(string did);

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BACKEND_ROLE, admin);
        _grantRole(REVOCATION_ADMIN_ROLE, admin);
    }

    /**
     * @notice Append an access-event hash.
     * @dev Callers should fire this WITHOUT awaiting confirmation. A block takes
     *      ~12s on a public network and nobody will stand at a door that long;
     *      the unlock decision comes from the (free, instant) view calls.
     */
    function logEvent(string calldata _eventHash, string calldata _doorCode)
        external
        onlyRole(BACKEND_ROLE)
    {
        if (bytes(_eventHash).length == 0 || bytes(_doorCode).length == 0) revert EmptyField();

        events.push(EventEntry({
            eventHash: _eventHash,
            doorCode: _doorCode,
            timestamp: block.timestamp
        }));

        emit EventLogged(events.length - 1, _eventHash, _doorCode, block.timestamp);
    }

    function getEventCount() external view returns (uint256) {
        return events.length;
    }

    function getEvents(uint256 _start, uint256 _count)
        external
        view
        returns (EventEntry[] memory)
    {
        uint256 total = events.length;
        if (_start >= total) return new EventEntry[](0);
        uint256 end = _start + _count;
        if (end > total) end = total;

        EventEntry[] memory page = new EventEntry[](end - _start);
        for (uint256 i = _start; i < end; i++) {
            page[i - _start] = events[i];
        }
        return page;
    }

    // ── Revocation list ───────────────────────────────────────────────────

    /**
     * @notice Revoke a DID. Every backend sees this on its next read, which is
     *         what makes "one click revokes access everywhere" work without a
     *         central server to push the update.
     */
    function revokeDID(string calldata _did) external onlyRole(REVOCATION_ADMIN_ROLE) {
        if (bytes(_did).length == 0) revert EmptyField();
        if (revokedDIDs[_did]) revert AlreadyRevoked(_did);

        revokedDIDs[_did] = true;
        revokedList.push(_did);
        revokedIndex[_did] = revokedList.length; // 1-based

        emit DIDRevoked(_did, block.timestamp);
    }

    /// @dev Swap-and-pop keeps removal O(1); order of the list is not meaningful.
    function restoreDID(string calldata _did) external onlyRole(REVOCATION_ADMIN_ROLE) {
        if (!revokedDIDs[_did]) revert NotRevoked(_did);

        uint256 idx = revokedIndex[_did] - 1;
        uint256 last = revokedList.length - 1;
        if (idx != last) {
            string memory moved = revokedList[last];
            revokedList[idx] = moved;
            revokedIndex[moved] = idx + 1;
        }
        revokedList.pop();

        delete revokedIndex[_did];
        revokedDIDs[_did] = false;

        emit DIDRestored(_did, block.timestamp);
    }

    function isRevoked(string calldata _did) external view returns (bool) {
        return revokedDIDs[_did];
    }

    function getRevokedCount() external view returns (uint256) {
        return revokedList.length;
    }

    function getRevokedList(uint256 _start, uint256 _count)
        external
        view
        returns (string[] memory)
    {
        uint256 total = revokedList.length;
        if (_start >= total) return new string[](0);
        uint256 end = _start + _count;
        if (end > total) end = total;

        string[] memory page = new string[](end - _start);
        for (uint256 i = _start; i < end; i++) {
            page[i - _start] = revokedList[i];
        }
        return page;
    }
}
