const { createRace } = require("./index");
const prototypeTrack = require("./prototype-track.json");

function createRoomMatch({ matchId, accounts, isSignedIn, track = prototypeTrack, practice = false }) {
    if (typeof matchId !== "string" || !matchId || typeof isSignedIn !== "function") {
        throw new TypeError("A room match needs a match ID and a session check");
    }
    if (!Array.isArray(accounts) || accounts.length !== 2 ||
        accounts.some(account => typeof account !== "string" || !account.trim()) ||
        accounts[0].toLowerCase() === accounts[1].toLowerCase()) {
        throw new TypeError("A room match needs two distinct accounts");
    }

    const course = structuredClone(track);
    const race = createRace({ players: accounts.map(account => ({ id: account })), track: course, practice });
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
        return { matchId, track: structuredClone(course), snapshot: { ...snapshot, events: [] } };
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
        return race.applyInput(account, input.action);
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
