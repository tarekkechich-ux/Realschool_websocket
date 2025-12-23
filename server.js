const http = require('http');
const WebSocket = require('ws');

class CanalManager {
  constructor() {
    this.canaux = new Map();
    this.socketIndex = new WeakMap();

  }
  
  // 🔥 O(1) - Ajout ultra-rapide
  inscrire(socket, canalName, logicalId) 
  {

   
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
  

  

  // 🔥 O(1) - Retrait rapide
  desinscrire(socket, canalName, logicalId)
  {
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
  desinscrireSocket(socket) 
  {

    // Retirer le socket de tous les canaux
    const socketCanaux = this.socketIndex.get(socket);
    if (!socketCanaux) return;
    
    // Parcourir tous les canaux où ce socket était inscrit
    for (const [canalName, logicalId] of socketCanaux) 
    {
      
      //Informer aussi les membre de chaque canal par proadcast que le membre est déconnecté
      //informer aussi le backend principal que le membre est déconnécté ceci pour la mise à jour de la base de donnée
      let Message={};
      Message["MESSAGE_ROLE"]="MEMBER_DISCONNECTED";
      Message["LOGICAL_ID"]=logicalId;
      this.diffuser(canalName,Message,logicalId);

      ///Message vers le backend principal:
      
      /*
        fetch('https://realschool.tn/WebSocket_Bridge.php', 
        {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json', // Indique au PHP que c'est du JSON
                  'Accept': 'application/json'
              },
              body: JSON.stringify(Message) // Convertit l'objet JS en chaîne JSON
        });
      */


        this.desinscrire(socket, canalName, logicalId);
    }
    
  
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
  diffuser(canalName, message, logicalId_Sender) 
{
  const canal = this.canaux.get(canalName);
  if (!canal) return;
  
  message["CANAL_NAME"] = canalName;
  const data = JSON.stringify(message);
  const throttleMs = message["THROTTELING"] || 0;
  
  let delay = 0;
  let count = 0;
  
  canal.forEach((groupe, logicalId) => 
  {
    if (logicalId != logicalId_Sender) 
    {
      groupe.forEach(socket => 
      {
        if (socket.readyState === WebSocket.OPEN) 
        {
          // 🔥 CLÉ: delay différent pour chaque socket
          setTimeout(() => 
          {
            socket.send(data);
          }, delay);
          
          delay += throttleMs; // Incrémenter pour le prochain
          count++;
        }
      });
    }
  });
  
  
}

  // 📊 Stats pour monitoring
  getStats() {
    const stats = 
  {
      totalCanaux: this.canaux.size,
      totalSockets: this.allSockets.size,
      canaux: {}
    };
    
    this.canaux.forEach((canal, canalName) => 
    {
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

  ws.on('message', data => 
  {
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

  ws.on('close', () => 
  {
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