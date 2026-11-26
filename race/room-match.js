const { createRace } = require("./index");
const fs = require("node:fs");
const path = require("node:path");

function createRoomMatch({ matchId, accounts, isSignedIn, track, practice = false, manualTest = false, hostAccount = accounts?.[0] }) {
    if (typeof matchId !== "string" || !matchId || typeof isSignedIn !== "function") {
        throw new TypeError("A room match needs a match ID and a session check");
    }

    if (!Array.isArray(accounts) || accounts.length !== 2 ||
        accounts.some(account => typeof account !== "string" || !account.trim()) ||
        accounts[0].toLowerCase() === accounts[1].toLowerCase()) {
        throw new TypeError("A room match needs two distinct accounts");
    }
    if (!accounts.includes(hostAccount)) throw new TypeError('The host must occupy a race seat');
    const controlAccounts = [hostAccount, accounts.find(account => account !== hostAccount)];
    const controls = { owner: controlAccounts[0], guest: controlAccounts[1], manualTest: manualTest === true };

    // Read once per new match, not once per server process. Rebuilding the map
    // must update new rooms, while running matches retain their original course.
    const course = track === undefined
        ? JSON.parse(fs.readFileSync(path.join(__dirname, "full-course.json"), "utf8"))
        : structuredClone(track);
    const race = createRace({ players: controlAccounts.map(account => ({ id: account })), track: course, practice });
    const sockets = new Map(accounts.map(account => [account, null]));
    for (const account of sockets.keys()) race.setConnected(account, false);

    function isCurrentSocket(socket) {
        const account = socket?.data?.account;
        const session = socket?.request?.session;
        return socket?.connected === true && sockets.has(account) &&
            session?.account === account && isSignedIn(session);
    }

    function attachSocket(socket) {
        if (!isCurrentSocket(socket)) return null;

        const account = socket.data.account;
        const oldSocket = sockets.get(account);
        if (oldSocket && oldSocket !== socket) race.setConnected(account, false);
        sockets.set(account, socket);
        race.setConnected(account, true);

        const snapshot = race.getSnapshot();
        return { matchId, controls: { ...controls }, track: structuredClone(course), snapshot: { ...snapshot, events: [] } };
    }

    function detachSocket(socket) {
        const account = socket?.data?.account;
        if (!socket || sockets.get(account) !== socket) return false;

        sockets.set(account, null);
        race.setConnected(account, false);
        return true;
    }

    function acceptInput(socket, input) {
        const account = socket?.data?.account;
        if (!socket || sockets.get(account) !== socket || input?.matchId !== matchId) return false;
        if (!isCurrentSocket(socket)) {
            detachSocket(socket);
            return false;
        }
        const target = input.controlSeat === undefined ? account : controlAccounts[input.controlSeat];
        if (input.controlSeat !== undefined && ![0, 1].includes(input.controlSeat)) return false;
        if (target !== account) {
            // Only rooms explicitly created for manual testing can relay the
            // other keyboard scheme. Both accounts still need valid sessions.
            const otherSocket = sockets.get(target);
            if (!controls.manualTest || !isCurrentSocket(otherSocket) ||
                !['left', 'right', 'up', 'down', 'fire'].includes(input.action)) return false;
        }
        return race.applyInput(target, input.action);
    }

    function step(publish) {
        for (const socket of sockets.values()) {
            if (socket && !isCurrentSocket(socket)) detachSocket(socket);
        }
        const update = { matchId, snapshot: race.step() };
        for (const socket of sockets.values()) {
            if (socket) publish(socket, update);
        }
        return update;
    }

    return { attachSocket, detachSocket, acceptInput, step };
}

module.exports = { createRoomMatch };
