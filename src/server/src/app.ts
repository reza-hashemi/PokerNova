import express from 'express';
import bodyParser from 'body-parser';
import http from 'http';
import socketIO from 'socket.io';
import { v1 as uuid } from 'uuid';
import Game from './classes/Game';
import { defaultPlayer } from './tests/_mockData';
import cloneDeep from 'lodash.clonedeep';
import { IPerformActionAPI, IJoinGameAPI, IStartGameAPI, IStateUpdated } from './interfaces/IAPI';
import { playerId, gameId } from './constants';
import { filterGameState } from './utils/filterGameState';
import { getUniqueId } from './utils/getUniqueId';
import path from 'path';
import Logger from './utilities/Logger';

/**
 * Application:
 * -  Sends gameState to client
 * -  Receives actions from client
 */

const app = express();
const server = new http.Server(app);
const io = socketIO(server);
const port = process.env.PORT || 5000;
const games: Map<string, Game> = new Map();
const playersToGameMapping: Map<playerId, gameId> = new Map();

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../../client/build')));

// SOCKET STUFF

const sendGameStateToPlayers = (game: Game) => {
  game.getGameState().players.forEach((player) => {
    const dataToSend: IStateUpdated = {
      gameState: filterGameState(game.getGameState(), player.id),
    };
    io.to(player.socketId).emit('stateUpdated', dataToSend);
  });
};

io.on('connection', (socket) => {
  const socketId: playerId = socket.id;
  console.log(`New connection! socket id: ${socketId}`);
  socket.on('joinGame', (data: IJoinGameAPI) => {
    const { gameId, name } = data;
    const game = games.get(gameId);
    if (game) {
      const nextAvailableSeat = game.getNextAvailableSeat();
      const uniqueId = uuid();

      if (nextAvailableSeat === -1) return; // Game is full
      playersToGameMapping.set(socketId, gameId);
      game.addPlayer({
        ...cloneDeep(defaultPlayer),
        id: nextAvailableSeat,
        name,
        socketId,
        uniqueId,
      });
      socket.join(gameId);

      socket.emit('joinGameSuccess', { seat: nextAvailableSeat, uniqueId, gameId });
      sendGameStateToPlayers(game);
    } else {
      // TODO: some error handling here
    }
  });

  socket.on('refreshSocket', ({ seat, gameId, uniqueId }) => {
    const game = games.get(gameId);
    if (game) {
      const player = game.getGameState().players[seat];
      if (player.uniqueId == uniqueId) {
        player.socketId = socket.id;
        sendGameStateToPlayers(game);
      }
    } else {
      // TODO: error handling
    }
  });
});

// API ROUTES

app.get('/api/game/:id', (req, res) => {
  const { id } = req.params;
  if (games.has(id)) {
    const game = games.get(id) as Game;
    res.status(200).send(game);
  } else {
    res.status(404).send({ error: 'game does not exist, sorry :(' });
  }
});

app.post('/api/game/create', (req, res) => {
  let id: string = getUniqueId(games);
  const game = new Game({ id });
  games.set(id, game);

  // Add listener for game updating and emit the new state to all sockets connected to that game
  game.on('stateUpdated', () => {
    sendGameStateToPlayers(game);
  });

  res.status(200).send({
    id,
    url: `localhost:${port}/game/${id}`,
  });
});

app.post('/api/game/start', (req, res) => {
  const { id }: IStartGameAPI = req.body;
  if (games.has(id)) {
    const game = games.get(id) as Game;
    game.start();
    sendGameStateToPlayers(game);
    res.status(200).send('Game successfully started!');
  } else {
    res.status(404).send('Game does not exist, sorry :(');
  }
});

app.post('/api/game/performAction', (req, res) => {
  const { gameId, playerId, action }: IPerformActionAPI = req.body;
  const game = games.get(gameId);
  if (game && game.getRound().getCurrentPlayer().id == playerId) {
    const didPerformAction = game.getRound().performAction(action);
    if (didPerformAction) {
      game.getRound().increment();
      console.log('successfuly performed action');
      res.status(200).send('Successfully performed action. Now its the next players turn!');
    } else {
      res.status(400).send('Invalid action');
    }
  } else {
    res.status(400).send('Error performing action. Please make sure gameId and playerId is valid');
  }
});

app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../client/build/index.html'));
});

server.listen(port, () => console.log(`Example app listening on port ${port}!`));
