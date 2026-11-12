# Comp4021
HTML Multiplayer Platform Game
Title: Edgerunner: Race to the Crystal Palace  

Home Page: The home page introduces the game and its controls. Players can register or sign in, create a room or join one with a room code, and ready up in the lobby. The race begins after both players are ready.  

Gameplay: Two players race through a cyberpunk course from the Slums through Downtown and the Spaceport toward the Crystal Palace. Players move between lanes and routes, collect coins, avoid or fight hazards, and use gadgets. The game runs in a browser and uses a Node.js server with WebSocket communication to synchronize the match between players.  

Controls: A/D or the left/right arrow keys change lanes. W/S or the up/down arrow keys change altitude during the orbital section. Left click fires; E activates a gadget; Q discards a module.  

Scoring and Results: The race lasts up to three minutes. Finishers rank ahead of players who do not finish; score and course progress resolve the remaining rankings. The end page shows each player’s rank, finish time or Did Not Finish status, collected items, score breakdown, stuns, and gadgets used. Players can request a rematch or return to the signed-in lobby.  

Cheat Mode: The room creator can choose Practice Room before the players ready up. During the race, either player can press C to toggle the cheat on or off. When active, it increases forward speed and grants immunity to hits, gadgets, and debris. The HUD indicates its status, and the results show who used it. Cheats reset to off at the start of every race.
