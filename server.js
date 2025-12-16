const http = require('http');
const WebSocket = require('ws');
// Gardez vos objets de stockage pour le reste de la logique si vous en avez besoin



class CanalManager 
{
  constructor() 
  {
    // 🎯 STRUCTURE CRUCIALE : Map de canaux → Map d'identifiants → Set de sockets
    this.canaux = new Map(); // { canalName → Map{ logicalId → Set{ws1, ws2, ...} } }
    
    // Index inverse pour cleanup rapide : socket → {canal → logicalId}
    this.socketIndex = new WeakMap(); 
  }

  // 🔥 O(1) - Ajout ultra-rapide
  inscrire(socket, canalName, logicalId) 
  {
    // Créer le canal si inexistant
    if (!this.canaux.has(canalName)) 
    {
      this.canaux.set(canalName, new Map());
    }
    
    const canal = this.canaux.get(canalName);
    
    // Créer le groupe logicalId si inexistant
    if (!canal.has(logicalId)) 
    {
      canal.set(logicalId, new Set());
    }
    
    // Ajouter le socket au groupe
    canal.get(logicalId).add(socket);
    
    // Mettre à jour l'index inverse pour cleanup
    if (!this.socketIndex.has(socket)) 
    {
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
    if (groupe) 
    {
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
      if (socketCanaux.size === 0) 
      {
        this.socketIndex.delete(socket);
      }
    }
  }

  // 🔥 O(1) - Retrait complet d'un socket (déconnexion)
  desinscrireSocket(socket) 
  {
    const socketCanaux = this.socketIndex.get(socket);
    if (!socketCanaux) return;
    
    // Parcourir tous les canaux où ce socket était inscrit
    for (const [canalName, logicalId] of socketCanaux) 
    {
      this.desinscrire(socket, canalName, logicalId);
    }
    
    console.log(`🧹 Socket retiré de tous les canaux`);
  }

  // 🎯 ENVOI OPTIMISÉ - O(1) pour ciblage précis
  envoyer(canalName, logicalIds, message) 
  {
    const canal = this.canaux.get(canalName);
    if (!canal) {
      console.log(`❌ Canal ${canalName} introuvable`);
      return;
    }

    const data = JSON.stringify(message);
    let envoyes = 0;
    
    // Si logicalIds est un tableau, envoyer à plusieurs groupes
    const idsArray = Array.isArray(logicalIds) ? logicalIds : [logicalIds];
    
    for (const logicalId of idsArray) {
      const groupe = canal.get(logicalId);
      if (groupe) 
      {
        groupe.forEach(socket => 
        {
          if (socket.readyState === WebSocket.OPEN) 
          {
            socket.send(data);
            envoyes++;
          }
        });
      }
    }
    
    
  }

  // 🌊 BROADCAST dans tout un canal - O(n) mais nécessaire
  diffuser(canalName, message,logicalId_Sender) 
  {
    const canal = this.canaux.get(canalName);
    if (!canal) return;
    message["CANAL_NAME"]=canalName;
    const data = JSON.stringify(message);
    let envoyes = 0;
    
    canal.forEach((groupe, logicalId) => 
    {
      if(logicalId !=logicalId_Sender)
      {
         groupe.forEach(socket => 
        {
          if (socket.readyState === WebSocket.OPEN) 
          {
            socket.send(data);
            envoyes++;
          }
        });
      }
     
    });
    
    
  }

  // 📊 Stats pour monitoring
  getStats() 
  {
    const stats = 
    {
      totalCanaux: this.canaux.size,
      canaux: {}
    };
    
    this.canaux.forEach((canal, canalName) => 
    {
      stats.canaux[canalName] = 
        {
        groupes: canal.size,
        totalSockets: Array.from(canal.values()).reduce((sum, groupe) => sum + groupe.size, 0)
      };
    });
    
    return stats;
  }
}
const canalManager = new CanalManager();
// Créez le serveur HTTP explicite
const server = http.createServer((req, res) => 
{
    // Gérez les requêtes HTTP ici
    if (req.method === 'POST' && req.url === '/api/push') 
    {
        let body = '';
        req.on('data', chunk => 
        {
            // Récupère les morceaux du message POST
            body += chunk.toString();
        });
        req.on('end', () => 
        {
            try 
            {
                // Restaure le message brut en objet/tableau JavaScript
                let Message = JSON.parse(body);
                


                

                console.log("Données reçues via API REST (POST /api/push)");
  
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'success', message: 'Données reçues et traitées.' }));

            } catch (e) 
            {
                // En cas d'erreur de parsing JSON
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ status: 'error', message: 'Données JSON invalides.' }));
            }
        });
    } 
    else 
    {
        // Réponse pour toutes les autres requêtes HTTP (ex: GET /)
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Endpoint non trouvé.');
    }
});

// Attachez le serveur WebSocket au serveur HTTP existant (votre logique WS reste intacte)
const wss = new WebSocket.Server({ server: server });

// Votre logique de connexion WebSocket existante
wss.on('connection', ws => 
{
   

    // On stocke le code de la session sur l'objet 'ws' lui-même
    ws.sessionCode = null;

    ws.on('message', data => 
    {
        let Allmessages;
        try 
        {
             Allmessages= JSON.parse(data);
             
            Allmessages.forEach((message)=>
          {
              switch(message["MESSAGE_ROLE"])
              {

                case "SUBSCRIBE":
                  message["CHANNEL_NAME"].forEach((ChannelName)=>
                  {
                    canalManager.inscrire(ws,ChannelName,message["LOGICAL_ID"]);
                  }
                
                
                  );
                break;

                case "UNSUBSCRIBE":
                message["CHANNEL_NAME"].forEach((ChannelName)=>
                {
                  
                  canalManager.desinscrire(ws,ChannelName,message["LOGICAL_ID"]);
                }
              
              
                );
                break;
                case "PUSH_NOTIFICATION":
                  message["CHANNEL_NAME"].forEach((ChannelName)=>
                  {
                    if(message["DEFFUSE_METHODE"]=="BROADCAST")
                    {
                      canalManager.diffuser(ChannelName,message["MESSAGES_DATA"],message["LOGICAL_ID"]);
                    }

                    if(message["DEFFUSE_METHODE"]=="PRIVATE")
                    {
                      canalManager.envoyer(ChannelName,message["MESSAGE_RECEIVER"],message["MESSAGES_DATA"]);
                    }
                    
                  }
                );

                break;


                

              }
            });


        } catch (e) 
        {
            console.error('Message invalide, non-JSON.', data);
            return;
        }

        
    });

    ws.on('close', () => 
    {
      canalManager.desinscrireSocket(ws);
    });

    ws.on('error', error => 
    {
        console.error('Erreur WebSocket:', error);
    });
});

// Lancez l'écoute sur le port (Koyeb utilise la variable d'environnement PORT)
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => 
{
    console.log(`Serveur HTTP et WebSocket démarré sur le port ${PORT}`);
});




