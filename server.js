const http = require('http');
const WebSocket = require('ws');

class CanalManager {
  constructor() {
    this.canaux = new Map();
    this.socketIndex = new WeakMap();
    
    // 🔥 NOUVEAU : Stockage des sockets actives
    this.allSockets = new Set(); // Pour pouvoir itérer sur les sockets
    
    this.HEART_BEATER = null;
  }
  
  // 🔥 O(1) - Ajout ultra-rapide
  inscrire(socket, canalName, logicalId) 
  {
    // 🔥 NOUVEAU : Ajouter le socket à la liste globale
    this.allSockets.add(socket);
    
    // 🔥 LOGIQUE D'ÉLECTION DU HEART_BEATER
    if (!this.HEART_BEATER) 
    {
      console.log("assignHeartBeater lors de l'inscription: "+logicalId);
      this.assignHeartBeater(socket);
    }
    
    // Créer le canal si inexistant
    if (!this.canaux.has(canalName)) {
      this.canaux.set(canalName, new Map());
    }
    
    const canal = this.canaux.get(canalName);
    
    // Créer le groupe logicalId si inexistant
    if (!canal.has(logicalId)) {
      canal.set(logicalId, new Set());
    }
    
    // Ajouter le socket au groupe
    canal.get(logicalId).add(socket);
    
    // Mettre à jour l'index inverse pour cleanup
    if (!this.socketIndex.has(socket)) {
      this.socketIndex.set(socket, new Map());
    }
    this.socketIndex.get(socket).set(canalName, logicalId);
  }
  
  // 🔥 NOUVEAU : Méthode pour assigner un heart_beater
  assignHeartBeater(socket) 
  {
    this.HEART_BEATER = socket;
    let Message = {};
    Message["MESSAGE_CODE"] = "DELEGATE_KEEP_ALIVE_MISSION";
    Message["INTERVAL"] = 25000; // 25 secondes
    
    const data = JSON.stringify(Message);
    
    // Vérifier que le socket est encore ouvert
    if (socket.readyState === WebSocket.OPEN) 
    {
      socket.send(data);
      
    } else 
    {
     
      this.HEART_BEATER = null;
    }
  }
  
  // 🔥 NOUVEAU : Méthode pour obtenir un ID de socket (pour le logging)
  getSocketId(socket) {
    return `socket_${socket._socket?.remoteAddress}:${socket._socket?.remotePort}` || 'unknown';
  }
  
  // 🔥 O(1) - Retrait rapide
  desinscrire(socket, canalName, logicalId) {
    const canal = this.canaux.get(canalName);
    if (!canal) return;
    
    const groupe = canal.get(logicalId);
    if (groupe) {
      groupe.delete(socket);
      
      // Nettoyage automatique si groupe vide
      if (groupe.size === 0) {
        canal.delete(logicalId);
      }
    }

    // Nettoyage canal si vide
    if (canal.size === 0) {
      this.canaux.delete(canalName);
    }
    
    // Mettre à jour l'index inverse
    const socketCanaux = this.socketIndex.get(socket);
    if (socketCanaux) {
      socketCanaux.delete(canalName);
      if (socketCanaux.size === 0) {
        this.socketIndex.delete(socket);
      }
    }
  }

  // 🔥 O(1) - Retrait complet d'un socket (déconnexion)
  desinscrireSocket(socket) {
    // 🔥 PARTIE 3 : Gestion du HEART_BEATER qui se déconnecte
    if (this.HEART_BEATER === socket) 
    {
    // console.log(`⚠️  HeartBeater se déconnecte, recherche d'un remplaçant...`);
      
      // Retirer des sockets actives
      this.allSockets.delete(socket);
      
      // Trouver un nouveau socket valide
      const newHeartBeater = this.findNewHeartBeater();
      
      if (newHeartBeater) {
        this.assignHeartBeater(newHeartBeater);
      } else {
        this.HEART_BEATER = null;
       // console.log(`❌ Aucun socket disponible pour devenir HeartBeater`);
      }
    } else 
    {
      // Juste retirer le socket normalement
      this.allSockets.delete(socket);
    }
    
    // Retirer le socket de tous les canaux
    const socketCanaux = this.socketIndex.get(socket);
    if (!socketCanaux) return;
    
    // Parcourir tous les canaux où ce socket était inscrit
    for (const [canalName, logicalId] of socketCanaux) {
      this.desinscrire(socket, canalName, logicalId);
    }
    
  
  }
  
  // 🔥 NOUVEAU : Trouver un nouveau HeartBeater
  findNewHeartBeater() 
  {
    // Parcourir tous les sockets actifs
    for (const socket of this.allSockets) 
    {
      // Vérifier que le socket est ouvert ET n'est pas le HEART_BEATER actuel
      if (socket.readyState === WebSocket.OPEN && socket !== this.HEART_BEATER) 
      {
       
        return socket;
      }
    }
    
    // Aucun socket valide trouvé
    return null;
  }
  
  // 🔥 NOUVEAU : Vérifier périodiquement que le HeartBeater est toujours actif
  startHeartbeatMonitoring() 
  {
    setInterval(() => 
    {
      if (this.HEART_BEATER && this.HEART_BEATER.readyState !== WebSocket.OPEN) 
      {
        //console.log(`🚨 HeartBeater inactif détecté, recherche remplaçant...`);
        const newHeartBeater = this.findNewHeartBeater();
        
        if (newHeartBeater) 
        {
          this.assignHeartBeater(newHeartBeater);
        } else {
          this.HEART_BEATER = null;
        }
      }
    }, 30000); // Vérifier toutes les 30 secondes
  }

  // 🎯 ENVOI OPTIMISÉ - O(1) pour ciblage précis
  envoyer(canalName, logicalIds, message) 
  {
    const canal = this.canaux.get(canalName);
    if (!canal) 
    {
     // console.log(`❌ Canal ${canalName} introuvable`);
      return;
    }

    const data = JSON.stringify(message);
    let envoyes = 0;
    
    // Si logicalIds est un tableau, envoyer à plusieurs groupes
    const idsArray = Array.isArray(logicalIds) ? logicalIds : [logicalIds];
    
    for (const logicalId of idsArray) {
      const groupe = canal.get(logicalId);
      if (groupe) {
        groupe.forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
            envoyes++;
          }
        });
      }
    }
  }

  // 🌊 BROADCAST dans tout un canal - O(n) mais nécessaire
  diffuser(canalName, message, logicalId_Sender) {
    const canal = this.canaux.get(canalName);
    if (!canal) return;
    message["CANAL_NAME"] = canalName;
    const data = JSON.stringify(message);
    let envoyes = 0;
    
    canal.forEach((groupe, logicalId) => {
      if (logicalId != logicalId_Sender) {
        groupe.forEach(socket => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(data);
            envoyes++;
          }
        });
      }
    });
  }

  // 📊 Stats pour monitoring
  getStats() {
    const stats = {
      totalCanaux: this.canaux.size,
      totalSockets: this.allSockets.size,
      hasHeartBeater: !!this.HEART_BEATER,
      heartBeaterStatus: this.HEART_BEATER ? 
        (this.HEART_BEATER.readyState === WebSocket.OPEN ? 'ACTIVE' : 'INACTIVE') : 'NONE',
      canaux: {}
    };
    
    this.canaux.forEach((canal, canalName) => {
      stats.canaux[canalName] = {
        groupes: canal.size,
        totalSockets: Array.from(canal.values()).reduce((sum, groupe) => sum + groupe.size, 0)
      };
    });
    
    return stats;
  }
}

const canalManager = new CanalManager();
// Démarrer le monitoring du HeartBeater
canalManager.startHeartbeatMonitoring();

// Créez le serveur HTTP explicite
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/push') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        let Message = JSON.parse(body);
        console.log("Données reçues via API REST (POST /api/push)");
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', message: 'Données reçues et traitées.' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: 'Données JSON invalides.' }));
      }
    });
  } else if (req.method === 'GET' && req.url === '/api/stats') {
    // 🔥 NOUVEAU : Endpoint pour voir les stats
    const stats = canalManager.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
  } else if (req.method === 'GET' && req.url === '/health') {
    // 🔥 NOUVEAU : Health check pour Koyeb
    const stats = canalManager.getStats();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      ...stats
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Endpoint non trouvé.');
  }
});

// Attachez le serveur WebSocket au serveur HTTP existant
const wss = new WebSocket.Server({ server: server });

// Votre logique de connexion WebSocket existante
wss.on('connection', ws => {
  ws.sessionCode = null;

  ws.on('message', data => {
    let Allmessages;
    try {
      Allmessages = JSON.parse(data);
      
      Allmessages.forEach((message) => 
      {
        
        switch(message["MESSAGE_ROLE"]) 
        {
          case "SUBSCRIBE":
            message["CHANNEL_NAME"].forEach((ChannelName) => 
            {
              canalManager.inscrire(ws, ChannelName, message["LOGICAL_ID"]);
            });
            break;

          case "UNSUBSCRIBE":
            message["CHANNEL_NAME"].forEach((ChannelName) => 
            {
              canalManager.desinscrire(ws, ChannelName, message["LOGICAL_ID"]);
            });
            break;
            
          case "PUSH_NOTIFICATION":
            message["CHANNEL_NAME"].forEach((ChannelName) => 
          {
              if (message["DEFFUSE_METHODE"] == "BROADCAST") {
                canalManager.diffuser(ChannelName, message["MESSAGES_DATA"], message["LOGICAL_ID"]);
              }
              if (message["DEFFUSE_METHODE"] == "PRIVATE") {
                canalManager.envoyer(ChannelName, message["MESSAGE_RECEIVER"], message["MESSAGES_DATA"]);
              }
            });
            break;
            
          // 🔥 NOUVEAU : Gestion du heartbeat du client désigné
          case "HEARTBEAT_PONG":
          //  console.log(`💓 Heartbeat reçu de ${canalManager.getSocketId(ws)}`);
            break;
        }
      });
    } catch (e) {
      console.error('Message invalide, non-JSON.', data);
      return;
    }
  });

  ws.on('close', () => {
    canalManager.desinscrireSocket(ws);
  });

  ws.on('error', error => {
    console.error('Erreur WebSocket:', error);
  });
});

// Lancez l'écoute sur le port
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`Serveur HTTP et WebSocket démarré sur le port ${PORT}`);
  console.log(`📊 Endpoint stats: http://localhost:${PORT}/api/stats`);
  console.log(`🏥 Health check: http://localhost:${PORT}/health`);
});