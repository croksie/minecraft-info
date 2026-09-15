// priority: 50
// =============================================================================
// Third World Server Script - Moteur de Conflits Multi-Guerres & Coalitions
// =============================================================================

var WAR_COST = (typeof TW_CONFIG !== 'undefined' && TW_CONFIG.general && TW_CONFIG.general.military) ? TW_CONFIG.general.military.war_cost : 2500 // Coût de déclaration en Robert Coins (R)
var CONFLICT_COST = (typeof TW_CONFIG !== 'undefined' && TW_CONFIG.general && TW_CONFIG.general.military) ? TW_CONFIG.general.military.conflict_cost : 250 // Coût d'escarmouche par nation en Robert Coins (R)
var CONFLICT_WARMUP_MS = (typeof TW_CONFIG !== 'undefined' && TW_CONFIG.general && TW_CONFIG.general.military) ? TW_CONFIG.general.military.conflict_warmup_ms : 300000 // 5 minutes de préavis avant l'assaut (300 000 ms)
var CONFLICT_DURATION_MS = (typeof TW_CONFIG !== 'undefined' && TW_CONFIG.general && TW_CONFIG.general.military) ? TW_CONFIG.general.military.conflict_duration_ms : 3600000 // 60 minutes de chrono strict (3 600 000 ms)
var WARS_CACHE = null

/**
 * Récupère une entrée de guerre de façon sécurisée (supporte Map Java et Objet JS)
 */
function getWar(wars, id) {
    if (!wars || id === null || id === undefined) return null
    var sId = String(id)
    if (typeof wars.get === 'function') {
        try {
            var item = wars.get(sId)
            if (item) return item
            var num = parseInt(sId, 10)
            if (!isNaN(num)) {
                item = wars.get(num)
                if (item) return item
            }
        } catch (me) { }
    }
    try {
        if (wars[sId]) return wars[sId]
    } catch (e) { }
    return null
}

/**
 * Enregistre ou met à jour une guerre
 */
function setWar(wars, id, warObj) {
    if (!wars || id === null || id === undefined) return
    var sId = String(id)
    if (typeof wars.put === 'function') {
        try { wars.put(sId, warObj) } catch (pe) { }
    }
    try {
        wars[sId] = warObj
    } catch (e) { }
}

/**
 * Supprime une guerre du registre
 */
function deleteWar(wars, id) {
    if (!wars || id === null || id === undefined) return
    var sId = String(id)
    if (typeof wars.remove === 'function') {
        try { wars.remove(sId) } catch (re) { }
    }
    try {
        delete wars[sId]
    } catch (e) { }
}

/**
 * Charge le registre des guerres depuis le cache mémoire et le fichier wars.json
 */
function loadWarsRegistry(server) {
    if (WARS_CACHE !== null) return WARS_CACHE
    var fileData = readJsonData('wars.json')
    if (fileData) {
        WARS_CACHE = (typeof toJsObject === 'function') ? toJsObject(fileData) : fileData
        return WARS_CACHE
    }
    WARS_CACHE = {}
    return WARS_CACHE
}

/**
 * Sauvegarde le registre des guerres en mémoire vive et sur disque
 */
function saveWarsRegistry(server, wars) {
    WARS_CACHE = wars || {}
    writeJsonData('wars.json', WARS_CACHE)
}

/**
 * Génère un ID de guerre court et séquentiel (#1, #2, #3...)
 */
function getNextWarId(server) {
    var wars = loadWarsRegistry(server)
    var count = 0
    for (var k in wars) {
        var n = parseInt(k, 10)
        if (!isNaN(n) && n > count) count = n
    }
    count++
    return count.toString()
}

/**
 * Recherche intelligente d'une guerre (par ID court, ID complet, ou nom de nation)
 */
function findWarQuery(server, query, requirePending) {
    if (!server) return null
    var wars = loadWarsRegistry(server)

    // 1. Si aucun argument : sélectionne la dernière guerre en attente (ou active)
    if (!query || query.trim() === '') {
        var lastPending = null
        var lastActive = null
        for (var id in wars) {
            var w = getWar(wars, id)
            if (!w) continue
            if (w.status === 'PENDING_ADMIN') lastPending = w
            if (w.status === 'ACTIVE') lastActive = w
        }
        if (requirePending) return lastPending
        return lastActive || lastPending
    }

    var q = query.toLowerCase().trim()
    if (q.startsWith('#')) q = q.substring(1)

    // 2. Recherche directe par clé exacte
    var direct = getWar(wars, q) || getWar(wars, 'war_' + q)
    if (direct) {
        if (!requirePending || direct.status === 'PENDING_ADMIN') return direct
    }

    // 3. PRIORITÉ : Recherche d'abord parmi les guerres ACTIVES
    for (var wId in wars) {
        var w = getWar(wars, wId)
        if (!w || w.status !== 'ACTIVE') continue

        var nameA = (w.attackerName || getTeamDisplayName(server, w.attackerLeader)).toLowerCase()
        var nameB = (w.defenderName || getTeamDisplayName(server, w.defenderLeader)).toLowerCase()
        if (nameA === q || nameB === q || nameA.includes(q) || nameB.includes(q) || String(w.id).toLowerCase() === q) {
            return w
        }
    }

    // 4. Recherche parmi les guerres EN ATTENTE (PENDING_ADMIN)
    for (var wId2 in wars) {
        var w2 = getWar(wars, wId2)
        if (!w2 || w2.status !== 'PENDING_ADMIN') continue

        var nameA2 = (w2.attackerName || getTeamDisplayName(server, w2.attackerLeader)).toLowerCase()
        var nameB2 = (w2.defenderName || getTeamDisplayName(server, w2.defenderLeader)).toLowerCase()
        if (nameA2 === q || nameB2 === q || nameA2.includes(q) || nameB2.includes(q) || String(w2.id).toLowerCase() === q) {
            return w2
        }
    }

    // 5. Recherche historique parmi toutes les guerres terminées
    if (!requirePending) {
        for (var wId3 in wars) {
            var w3 = getWar(wars, wId3)
            if (!w3) continue
            var nameA3 = (w3.attackerName || getTeamDisplayName(server, w3.attackerLeader)).toLowerCase()
            var nameB3 = (w3.defenderName || getTeamDisplayName(server, w3.defenderLeader)).toLowerCase()
            if (nameA3 === q || nameB3 === q || nameA3.includes(q) || nameB3.includes(q) || String(w3.id).toLowerCase() === q) {
                return w3
            }
        }
    }

    return null
}

/**
 * Vérifie si deux équipes sont ennemies dans une guerre ACTIVE (exclut les simples conflits d'escarmouche)
 */
function isNationAtWarWith(server, teamAId, teamBId) {
    if (!teamAId || !teamBId || !server) return false
    var aStr = teamAId.toString()
    var bStr = teamBId.toString()
    if (aStr === bStr) return false

    var wars = loadWarsRegistry(server)
    for (var id in wars) {
        var w = getWar(wars, id)
        if (!w || w.status !== 'ACTIVE' || w.type === 'CONFLICT') continue

        var inAtk = w.attackers && w.attackers.indexOf(aStr) !== -1
        var inDef = w.defenders && w.defenders.indexOf(bStr) !== -1
        if (inAtk && inDef) return true

        var inAtk2 = w.attackers && w.attackers.indexOf(bStr) !== -1
        var inDef2 = w.defenders && w.defenders.indexOf(aStr) !== -1
        if (inAtk2 && inDef2) return true
    }
    return false
}

/**
 * Récupère la liste des guerres actives d'une équipe (exclut les conflits)
 */
function getTeamActiveWars(server, teamId) {
    if (!teamId || !server) return []
    var idStr = teamId.toString()
    var wars = loadWarsRegistry(server)
    var result = []
    for (var id in wars) {
        var w = getWar(wars, id)
        if (w && w.status === 'ACTIVE' && w.type !== 'CONFLICT') {
            if ((w.attackers && w.attackers.indexOf(idStr) !== -1) || (w.defenders && w.defenders.indexOf(idStr) !== -1)) {
                result.push(w)
            }
        }
    }
    return result
}

/**
 * Récupère la liste des conflits actifs ou en préavis d'une équipe
 */
function getTeamActiveConflicts(server, teamId) {
    if (!teamId || !server) return []
    var idStr = teamId.toString()
    var wars = loadWarsRegistry(server)
    var result = []
    for (var id in wars) {
        var w = getWar(wars, id)
        if (w && w.type === 'CONFLICT' && (w.status === 'ACTIVE' || w.status === 'COUNTDOWN')) {
            if ((w.attackers && w.attackers.indexOf(idStr) !== -1) || (w.defenders && w.defenders.indexOf(idStr) !== -1)) {
                result.push(w)
            }
        }
    }
    return result
}

/**
 * Trouve une guerre active entre deux équipes
 */
function findActiveWarBetween(server, teamAId, teamBId) {
    if (!teamAId || !teamBId || !server) return null
    var aStr = teamAId.toString()
    var bStr = teamBId.toString()
    var wars = loadWarsRegistry(server)
    for (var id in wars) {
        var w = getWar(wars, id)
        if (!w || w.status !== 'ACTIVE' || w.type === 'CONFLICT') continue
        var hasA = (w.attackers.indexOf(aStr) !== -1 || w.defenders.indexOf(aStr) !== -1)
        var hasB = (w.attackers.indexOf(bStr) !== -1 || w.defenders.indexOf(bStr) !== -1)
        if (hasA && hasB) return w
    }
    return null
}

/**
 * Trouve un conflit actif ou en préavis entre deux équipes
 */
function findActiveConflictBetween(server, teamAId, teamBId) {
    if (!teamAId || !teamBId || !server) return null
    var aStr = teamAId.toString()
    var bStr = teamBId.toString()
    var wars = loadWarsRegistry(server)
    for (var id in wars) {
        var w = getWar(wars, id)
        if (!w || w.type !== 'CONFLICT') continue
        if (w.status !== 'ACTIVE' && w.status !== 'COUNTDOWN') continue
        var hasA = (w.attackers.indexOf(aStr) !== -1 || w.defenders.indexOf(aStr) !== -1)
        var hasB = (w.attackers.indexOf(bStr) !== -1 || w.defenders.indexOf(bStr) !== -1)
        if (hasA && hasB) return w
    }
    return null
}

/**
 * Intègre une équipe alliée à une coalition
 */
function joinWarCoalition(server, warId, allyTeamId, callingTeamIdStr) {
    if (!server || !warId || !allyTeamId) return false
    var wars = loadWarsRegistry(server)
    var w = getWar(wars, warId)
    if (!w || w.status !== 'ACTIVE') return false

    var allyStr = allyTeamId.toString()
    var allyName = getTeamDisplayName(server, allyStr)

    if (w.attackers.indexOf(callingTeamIdStr) !== -1) {
        if (w.attackers.indexOf(allyStr) === -1) {
            w.attackers.push(allyStr)
            if (!w.attackerNames) w.attackerNames = []
            if (w.attackerNames.indexOf(allyName) === -1) w.attackerNames.push(allyName)
        }
    } else if (w.defenders.indexOf(callingTeamIdStr) !== -1) {
        if (w.defenders.indexOf(allyStr) === -1) {
            w.defenders.push(allyStr)
            if (!w.defenderNames) w.defenderNames = []
            if (w.defenderNames.indexOf(allyName) === -1) w.defenderNames.push(allyName)
        }
    }

    saveWarsRegistry(server, wars)

    // Rupture immédiate de toute alliance avec une nation du camp adverse (Règle : pas d'alliance entre belligérants opposés)
    try {
        var opposingCamp = (w.attackers.indexOf(allyStr) !== -1) ? w.defenders : w.attackers
        var UUIDClass = Java.loadClass('java.util.UUID')
        for (var e = 0; e < opposingCamp.length; e++) {
            var enemyIdStr = opposingCamp[e]
            if (typeof isAllied === 'function' && isAllied(server, allyTeamId, enemyIdStr)) {
                if (typeof breakAlliance === 'function') {
                    breakAlliance(server, allyTeamId, UUIDClass.fromString(enemyIdStr), 'cross_war')
                    broadcastMsg(server, 'Diplomatie', 'L\'alliance entre §e' + allyName + ' §fet §e' + getTeamDisplayName(server, enemyIdStr) + ' §fa été rompue car elles s\'affrontent dans la guerre #' + w.id + ' !', '§c')
                }
            }
        }
    } catch (crossErr) {
        console.error('[WarSystem] Erreur rupture alliance croisée : ' + crossErr)
    }

    return true
}

/**
 * Déclaration de guerre soumise par un Leader ou un Staff (nécessite validation staff pour les joueurs normaux)
 */
function requestWarDeclaration(player, targetQuery) {
    if (!player) return 0
    var server = player.server
    var team = getPlayerNationTeam(player)
    if (!team) {
        sendMsg(player, 'Guerre', 'Vous devez appartenir à une nation.', '§c')
        return 0
    }
    var isOp = player.hasPermissions(2)
    if (!isTeamOwner(team, player) && !isOp) {
        sendMsg(player, 'Guerre', 'Seul le Leader de la nation peut déclarer une guerre.', '§c')
        return 0
    }

    var targetTeam = findTeamByNameOrPlayer(server, targetQuery)
    if (!targetTeam) {
        sendMsg(player, 'Guerre', 'Nation introuvable : "' + targetQuery + '".', '§c')
        return 0
    }

    if (targetTeam.getId().equals(team.getId())) {
        sendMsg(player, 'Guerre', 'Vous ne pouvez pas déclarer la guerre à votre propre nation.', '§c')
        return 0
    }

    if (isNationAtWarWith(server, team.getId(), targetTeam.getId())) {
        sendMsg(player, 'Guerre', 'Vous êtes déjà en guerre contre cette nation.', '§c')
        return 0
    }

    // Vérifier si une demande est déjà en attente entre ces deux nations
    var warsCheck = loadWarsRegistry(server)
    for (var wId in warsCheck) {
        var wCheck = getWar(warsCheck, wId)
        if (wCheck && wCheck.status === 'PENDING_ADMIN') {
            if (wCheck.attackerLeader === team.getId().toString() && wCheck.defenderLeader === targetTeam.getId().toString()) {
                sendMsg(player, 'Guerre', 'Une déclaration de guerre #' + wCheck.id + ' contre cette nation est déjà en attente d\'approbation par le Staff.', '§e')
                return 0
            }
        }
    }

    // Débit des frais de déclaration de guerre (obligatoire pour déclarer)
    var costPaid = false
    if (typeof withdrawNationMoney === 'function') {
        costPaid = withdrawNationMoney(team, player, WAR_COST)
    }
    if (!costPaid) {
        sendMsg(player, 'Guerre', 'Fonds insuffisants ! La déclaration de guerre coûte ' + WAR_COST + ' R au Trésor national de votre pays.', '§c')
        return 0
    }

    // Trahison / rupture automatique de l'alliance si les deux nations étaient alliées
    if (typeof isAllied === 'function' && isAllied(server, team.getId(), targetTeam.getId())) {
        if (typeof breakAlliance === 'function') {
            breakAlliance(server, team.getId(), targetTeam.getId(), 'war_declaration')
        }
    }

    var warId = getNextWarId(server)
    var wars = loadWarsRegistry(server)
    var atkName = team.getName().getString()
    var defName = targetTeam.getName().getString()

    var newWar = {
        id: warId,
        type: 'WAR',
        status: 'PENDING_ADMIN', // Toujours en attente de validation admin
        requesterUuid: player.getStringUuid ? player.getStringUuid() : player.uuid.toString(),
        attackerName: atkName,
        defenderName: defName,
        attackerLeader: team.getId().toString(),
        defenderLeader: targetTeam.getId().toString(),
        attackers: [team.getId().toString()],
        defenders: [targetTeam.getId().toString()],
        attackerNames: [atkName],
        defenderNames: [defName],
        costPaid: WAR_COST,
        createdAt: Date.now(),
        startedAt: null,
        peaceRequestedBy: null
    }
    setWar(wars, warId, newWar)
    saveWarsRegistry(server, wars)

    sendMsg(player, 'Guerre', 'Demande de guerre #' + warId + ' contre §e' + defName + ' §fsoumise au Staff (' + WAR_COST + ' R débités). En attente d\'approbation admin.', '§a')

    // Alerte Staff interactive avec boutons cliquables envoyée à tous les OPs en ligne
    var staffMsg = Component.literal('§7[§6Staff§7] §fDemande de guerre §e#' + warId + ' §f: §e' + atkName + ' §fVS §e' + defName + ' §7| ')
    try {
        var btnApprove = Component.literal('§a§l[ACCEPTER]')
            .clickRunCommand('/war approve ' + warId)
            .hover(Component.literal('§aCliquer pour valider la guerre #' + warId))
        var btnReject = Component.literal('§c§l[REFUSER]')
            .clickRunCommand('/war reject ' + warId)
            .hover(Component.literal('§cCliquer pour refuser et rembourser la guerre #' + warId))

        staffMsg = staffMsg.append(btnApprove).append(Component.literal(' ')).append(btnReject)
    } catch (e) {
        staffMsg = Component.literal('§7[§6Staff§7] §fDemande de guerre #' + warId + ' : §e' + atkName + ' §fVS §e' + defName + ' §f(Tapez §a/war approve ' + warId + '§f)')
    }

    try {
        var playerList = server.getPlayerList().getPlayers()
        for (var i = 0; i < playerList.size(); i++) {
            var staffP = playerList.get(i)
            if (staffP && staffP.hasPermissions(2)) {
                staffP.tell(staffMsg)
            }
        }
    } catch (pe) { }
    return 1
}

/**
 * Lance immédiatement une guerre active (admin/OP ou test)
 */
function startActiveWar(server, player, targetQuery) {
    if (!server) return 0
    var team = player ? getPlayerNationTeam(player) : null
    if (!team) {
        if (player) sendMsg(player, 'Guerre', 'Vous devez appartenir à une nation.', '§c')
        return 0
    }
    var targetTeam = findTeamByNameOrPlayer(server, targetQuery)
    if (!targetTeam) {
        if (player) sendMsg(player, 'Guerre', 'Nation introuvable : "' + targetQuery + '".', '§c')
        return 0
    }
    if (targetTeam.getId().equals(team.getId())) {
        if (player) sendMsg(player, 'Guerre', 'Vous ne pouvez pas déclarer la guerre à votre propre nation.', '§c')
        return 0
    }

    if (isNationAtWarWith(server, team.getId(), targetTeam.getId())) {
        if (player) sendMsg(player, 'Guerre', 'Votre nation est déjà en guerre active contre ' + targetTeam.getName().getString() + '.', '§c')
        return 0
    }

    // Trahison / rupture automatique de l'alliance si les deux nations étaient alliées
    if (typeof isAllied === 'function' && isAllied(server, team.getId(), targetTeam.getId())) {
        if (typeof breakAlliance === 'function') {
            breakAlliance(server, team.getId(), targetTeam.getId(), 'war_declaration')
        }
    }

    // Si une demande était en attente, on l'approuve
    var wars = loadWarsRegistry(server)
    for (var wid in wars) {
        if (!wars.hasOwnProperty(wid)) continue
        var w = getWar(wars, wid)
        if (w && w.status === 'PENDING_ADMIN') {
            var hasA = (w.attackers && w.attackers.indexOf(team.getId().toString()) !== -1) || (w.defenders && w.defenders.indexOf(team.getId().toString()) !== -1)
            var hasB = (w.attackers && w.attackers.indexOf(targetTeam.getId().toString()) !== -1) || (w.defenders && w.defenders.indexOf(targetTeam.getId().toString()) !== -1)
            if (hasA && hasB) {
                return approveWar(server, wid) ? 1 : 0
            }
        }
    }

    var warId = getNextWarId(server)
    var atkName = team.getName().getString()
    var defName = targetTeam.getName().getString()

    var newWarActive = {
        id: warId,
        type: 'WAR',
        status: 'ACTIVE',
        requesterUuid: player ? (player.getStringUuid ? player.getStringUuid() : player.uuid.toString()) : 'console',
        attackerName: atkName,
        defenderName: defName,
        attackerLeader: team.getId().toString(),
        defenderLeader: targetTeam.getId().toString(),
        attackers: [team.getId().toString()],
        defenders: [targetTeam.getId().toString()],
        attackerNames: [atkName],
        defenderNames: [defName],
        costPaid: 0,
        createdAt: Date.now(),
        startedAt: Date.now(),
        peaceRequestedBy: null
    }
    setWar(wars, warId, newWarActive)
    saveWarsRegistry(server, wars)

    broadcastMsg(server, 'Guerre', 'Guerre lancée (# ' + warId + ') : §e' + atkName + ' §fcontre §e' + defName + ' §f! Les hostilités sont ouvertes.', '§c')
    if (typeof triggerCallToArms === 'function') {
        var wActive = getWar(wars, warId)
        if (wActive) {
            var aTeam2 = getTeamById(server, wActive.attackerLeader)
            var bTeam2 = getTeamById(server, wActive.defenderLeader)
            if (aTeam2 && bTeam2) {
                triggerCallToArms(server, warId, aTeam2.getId(), bTeam2.getId())
                triggerCallToArms(server, warId, bTeam2.getId(), aTeam2.getId())
            }
        }
    }
    return 1
}

/**
 * Arrête de force une guerre
 */
function forceStopWar(server, player, targetQuery) {
    if (!server) return 0
    var w = findWarQuery(server, targetQuery, false)
    if (w) {
        w.status = 'ENDED'
        w.endedAt = Date.now()
        var wars = loadWarsRegistry(server)
        setWar(wars, w.id, w)
        saveWarsRegistry(server, wars)

        if (w.type === 'CONFLICT') {
            if (typeof resetNationAltarFlag === 'function') {
                resetNationAltarFlag(server, w.defenderTeamId || w.defenderLeader)
            }
            if (typeof removeAllConflictFlags === 'function') {
                removeAllConflictFlags(server, w.id)
            }
        }

        if (typeof revokeAllWarBypasses === 'function') {
            revokeAllWarBypasses(server)
        }
        if (typeof updateWarExplosionPermissions === 'function') {
            updateWarExplosionPermissions(server)
        }

        broadcastMsg(server, 'Guerre', 'Le conflit/guerre #' + w.id + ' a été arrêté par les arbitres fédéraux.', '§6')
        return 1
    }
    if (player) sendMsg(player, 'Guerre', 'Guerre introuvable : "' + targetQuery + '".', '§c')
    return 0
}

/**
 * Commande intelligente /war <cible>
 */
function handleSmartWarCommand(player, targetQuery) {
    if (!player) return 0
    var server = player.server
    var team = getPlayerNationTeam(player)
    if (!team) {
        sendMsg(player, 'Guerre', 'Vous devez appartenir à une nation.', '§c')
        return 0
    }

    var targetTeam = findTeamByNameOrPlayer(server, targetQuery)
    if (!targetTeam) {
        sendMsg(player, 'Guerre', 'Nation introuvable : "' + targetQuery + '". Tapez §e/nation list §cpour voir les nations.', '§c')
        return 0
    }

    if (isNationAtWarWith(server, team.getId(), targetTeam.getId())) {
        var war = findActiveWarBetween(server, team.getId(), targetTeam.getId())
        var warId = war ? war.id : '?'
        sendMsg(player, 'Guerre #' + warId, 'Vous êtes en guerre §c§lACTIVE§f contre §e' + targetTeam.getName().getString() + '§f !', '§c')
        sendMsg(player, 'Raid Hours', getRaidHoursStatusText(), '§6')
        sendMsg(player, 'Paix', 'Pour négocier un traité de paix : §e/war peace ' + targetTeam.getName().getString(), '§a')
        return 1
    }

    return requestWarDeclaration(player, targetQuery)
}

/**
 * Validation d'une guerre par le Staff
 */
function approveWar(server, warQuery) {
    if (!server) return false
    var w = findWarQuery(server, warQuery, true)
    if (!w) return false

    w.status = 'ACTIVE'
    w.startedAt = Date.now()
    var wars = loadWarsRegistry(server)
    setWar(wars, w.id, w)
    saveWarsRegistry(server, wars)

    // Rupture automatique de l'alliance entre les belligérants s'ils étaient alliés
    if (typeof isAllied === 'function' && isAllied(server, w.attackerLeader, w.defenderLeader)) {
        if (typeof breakAlliance === 'function') {
            breakAlliance(server, w.attackerLeader, w.defenderLeader, 'war_declaration')
        }
    }

    var nameA = w.attackerName || getTeamDisplayName(server, w.attackerLeader)
    var nameB = w.defenderName || getTeamDisplayName(server, w.defenderLeader)

    broadcastMsg(server, 'Guerre', 'Guerre déclarée (# ' + w.id + ') : §e' + nameA + ' §fcontre §e' + nameB + ' §f! Les hostilités sont ouvertes.', '§c')

    // Déclenchement automatique des appels aux armes pour les alliés des deux camps
    if (typeof triggerCallToArms === 'function') {
        var aTeam = getTeamById(server, w.attackerLeader)
        var bTeam = getTeamById(server, w.defenderLeader)
        if (aTeam && bTeam) {
            triggerCallToArms(server, w.id, aTeam.getId(), bTeam.getId())
            triggerCallToArms(server, w.id, bTeam.getId(), aTeam.getId())
        }
    }
    return true
}

/**
 * Rejet d'une guerre par le Staff
 */
function rejectWar(server, warQuery, reason) {
    if (!server) return false
    var w = findWarQuery(server, warQuery, true)
    if (!w) return false

    var wars = loadWarsRegistry(server)
    var refund = w.costPaid || WAR_COST // Remboursement 100% intégral
    var aTeam = getTeamById(server, w.attackerLeader)
    if (aTeam && refund > 0 && typeof depositNationMoneyDirect === 'function') {
        depositNationMoneyDirect(aTeam, refund)
    }

    deleteWar(wars, w.id)
    saveWarsRegistry(server, wars)

    var nameA = w.attackerName || getTeamDisplayName(server, w.attackerLeader)
    var nameB = w.defenderName || getTeamDisplayName(server, w.defenderLeader)
    broadcastMsg(server, 'Staff', 'La demande de guerre #' + w.id + ' de §e' + nameA + ' §fcontre §e' + nameB + ' §fa été rejetée (' + refund + ' R remboursés intégralement).', '§e')
    return true
}

/**
 * Négociation et acceptation de paix bilatérale
 */
function handleWarPeace(player, targetQuery) {
    if (!player) return 0
    var server = player.server
    var team = getPlayerNationTeam(player)
    if (!team) {
        sendMsg(player, 'Diplomatie', 'Vous devez appartenir à une nation.', '§c')
        return 0
    }
    var isOp = player.hasPermissions(2)
    if (!isOp && !isTeamOfficerOrOwner(team, player)) {
        sendMsg(player, 'Diplomatie', 'Seuls le Leader et les Ministres peuvent négocier la paix.', '§c')
        return 0
    }

    var war = null
    var isForce = false
    var subAction = null

    // 1. Analyse des arguments passés
    if (targetQuery && targetQuery.trim() !== '') {
        var parts = targetQuery.trim().split(/\s+/)
        var firstWord = parts[0].toLowerCase()

        if (firstWord === 'force' || firstWord === 'admin') {
            if (isOp) {
                isForce = true
            } else {
                sendMsg(player, 'Diplomatie', 'Seuls les administrateurs peuvent forcer la paix.', '§c')
                return 0
            }
        } else if (firstWord === 'accept' || firstWord === 'yes' || firstWord === 'oui') {
            subAction = 'accept'
        } else if (firstWord === 'reject' || firstWord === 'decline' || firstWord === 'refuse' || firstWord === 'non') {
            subAction = 'reject'
        } else if (firstWord === 'cancel' || firstWord === 'annuler') {
            subAction = 'cancel'
        }

        // Si une nation spécifique est indiquée en 2e mot ou si ce n'était pas un mot-clé
        var nationQuery = subAction ? parts.slice(1).join(' ') : targetQuery.trim()
        if (nationQuery) {
            var tTeam = findTeamByNameOrPlayer(server, nationQuery)
            if (tTeam) {
                war = findActiveWarBetween(server, team.getId(), tTeam.getId())
            }
            if (!war) {
                war = findWarQuery(server, nationQuery, false)
            }
        }
    }

    // 2. Si aucune guerre trouvée par argument, chercher la guerre active de la nation
    if (!war) {
        var activeWars = getTeamActiveWars(server, team.getId())
        if (activeWars.length === 1) {
            war = activeWars[0]
        } else if (activeWars.length === 0) {
            sendMsg(player, 'Diplomatie', 'Votre nation n\'est engagée dans aucune guerre active.', '§a')
            return 0
        } else {
            sendMsg(player, 'Diplomatie', 'Plusieurs guerres actives ! Précisez la nation : §e/war peace <nation>', '§e')
            return 0
        }
    }

    if (!war || war.status !== 'ACTIVE') {
        sendMsg(player, 'Diplomatie', 'Aucun conflit actif correspondant trouvé.', '§c')
        return 0
    }

    var myTeamIdStr = team.getId().toString()
    var isAttackerCamp = (war.attackers && war.attackers.indexOf(myTeamIdStr) !== -1)
    var myCamp = isAttackerCamp ? 'attackers' : 'defenders'
    var opposingCamp = isAttackerCamp ? 'defenders' : 'attackers'

    // Cas d'annulation par le camp émetteur
    if (subAction === 'cancel') {
        if (war.peaceRequestedBy === myCamp) {
            war.peaceRequestedBy = null
            var warsC = loadWarsRegistry(server)
            setWar(warsC, war.id, war)
            saveWarsRegistry(server, warsC)
            sendMsg(player, 'Diplomatie', 'Votre proposition de paix a été annulée.', '§e')
            return 1
        } else {
            sendMsg(player, 'Diplomatie', 'Vous n\'avez aucune proposition de paix en cours à annuler.', '§c')
            return 0
        }
    }

    // Cas de refus par le camp récepteur
    if (subAction === 'reject') {
        if (war.peaceRequestedBy === opposingCamp) {
            war.peaceRequestedBy = null
            var warsR = loadWarsRegistry(server)
            setWar(warsR, war.id, war)
            saveWarsRegistry(server, warsR)

            sendMsg(player, 'Diplomatie', 'Vous avez rejeté la proposition de paix adverse.', '§c')
            var opposingLeaderIdR = isAttackerCamp ? war.defenderLeader : war.attackerLeader
            var oppTeamR = getTeamById(server, opposingLeaderIdR)
            if (oppTeamR) {
                notifyTeam(oppTeamR, 'Diplomatie', '§e' + team.getName().getString() + ' §ca rejeté votre proposition de paix. La guerre continue !', '§c')
            }
            return 1
        } else {
            sendMsg(player, 'Diplomatie', 'Aucune proposition de paix adverse en attente à refuser.', '§c')
            return 0
        }
    }

    // Cas de signature / acceptation de la paix
    if (isForce || war.peaceRequestedBy === opposingCamp || subAction === 'accept') {
        if (!isForce && war.peaceRequestedBy !== opposingCamp) {
            sendMsg(player, 'Diplomatie', 'Le camp adverse n\'a pas encore proposé la paix. Utilisez §e/war peace §apour faire une proposition.', '§c')
            return 0
        }

        war.status = 'ENDED'
        war.endedAt = Date.now()
        war.peaceRequestedBy = null
        var wars = loadWarsRegistry(server)
        setWar(wars, war.id, war)
        saveWarsRegistry(server, wars)

        var nameA = war.attackerName || getTeamDisplayName(server, war.attackerLeader)
        var nameB = war.defenderName || getTeamDisplayName(server, war.defenderLeader)

        if (typeof revokeAllWarBypasses === 'function') {
            revokeAllWarBypasses(server)
        }
        if (typeof updateWarExplosionPermissions === 'function') {
            updateWarExplosionPermissions(server)
        }

        broadcastMsg(server, 'Diplomatie', 'Le traité de paix entre §e' + nameA + ' §fet §e' + nameB + ' §fa été ratifié ! Fin des hostilités.', '§a')
        return 1
    } else if (war.peaceRequestedBy === myCamp) {
        sendMsg(player, 'Diplomatie', 'Votre camp a déjà proposé la paix. En attente de l\'acceptation adverse (Tapez §e/war peace cancel §cpour annuler).', '§e')
        return 1
    } else {
        // Initier la proposition de paix
        war.peaceRequestedBy = myCamp
        var wars2 = loadWarsRegistry(server)
        setWar(wars2, war.id, war)
        saveWarsRegistry(server, wars2)

        sendMsg(player, 'Diplomatie', 'Proposition de paix transmise au camp adverse. Tapez §e/war peace cancel §7pour annuler.', '§a')
        var opposingLeaderId = isAttackerCamp ? war.defenderLeader : war.attackerLeader
        var oppTeam = getTeamById(server, opposingLeaderId)
        if (oppTeam) {
            try {
                var oppOnline = oppTeam.getOnlineMembers()
                if (oppOnline) {
                    var it = oppOnline.iterator()
                    while (it.hasNext()) {
                        var p = it.next()
                        if (p) {
                            sendMsg(p, 'Diplomatie', '§6' + team.getName().getString() + ' §avous propose un traité de paix pour cesser la guerre !', '§a')
                            var acceptComp = Component.literal('  §a§l[✔ ACCEPTER LA PAIX]')
                                .clickRunCommand('/war peace accept')
                                .hover(Component.literal('§aCliquez pour accepter la paix et arrêter la guerre'))
                            var rejectComp = Component.literal('  §c§l[✖ REFUSER]')
                                .clickRunCommand('/war peace reject')
                                .hover(Component.literal('§cCliquez pour refuser la proposition de paix'))

                            p.tell(acceptComp.append(rejectComp))
                        }
                    }
                }
            } catch (clickErr) {
                notifyTeam(oppTeam, 'Diplomatie', '§aLe camp adverse propose la paix ! Tapez §e/war peace accept §apour signer, ou §c/war peace reject §cpour refuser.', '§a')
            }
        }
        return 1
    }
}

/**
 * Déclenchement d'un Conflit (Escarmouche CTF 60 minutes, pot 500 R)
 */
function requestConflict(player, targetQuery) {
    if (!player) return 0
    var server = player.server
    if (!server) return 0

    var team = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(player) : null
    if (!team) {
        sendMsg(player, 'Conflit', 'Vous devez appartenir à une nation pour engager un conflit.', '§c')
        return 0
    }

    var isOp = player.hasPermissions(2)
    if (!isTeamOfficerOrOwner(team, player) && !isOp) {
        sendMsg(player, 'Conflit', 'Seul le Leader ou un Ministre peut déclarer un conflit.', '§c')
        return 0
    }

    if (!targetQuery || targetQuery.trim() === '') {
        sendMsg(player, 'Conflit', 'Usage : /war conflict <NomDeLaNation>', '§e')
        return 0
    }

    var targetTeam = findTeamByNameOrPlayer(server, targetQuery)
    if (!targetTeam) {
        sendMsg(player, 'Conflit', 'Nation introuvable : "' + targetQuery + '". Tapez §e/nation list §cpour voir les nations.', '§c')
        return 0
    }

    if (targetTeam.getId().equals(team.getId())) {
        sendMsg(player, 'Conflit', 'Vous ne pouvez pas engager un conflit contre votre propre nation.', '§c')
        return 0
    }

    var sName = targetTeam.getShortName() ? String(targetTeam.getShortName()).toLowerCase() : ''
    if (sName === 'onu' || String(targetTeam.getId()) === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
        sendMsg(player, 'Conflit', 'Le territoire de l\'ONU est neutre et inviolable.', '§c')
        return 0
    }

    // 1. Vérifier si les deux nations sont déjà en guerre ou en conflit
    if (isNationAtWarWith(server, team.getId(), targetTeam.getId())) {
        sendMsg(player, 'Conflit', 'Votre nation est déjà en guerre déclarée contre cette nation !', '§c')
        return 0
    }

    if (typeof isNationInConflictWith === 'function' && isNationInConflictWith(server, team.getId(), targetTeam.getId())) {
        var existingConflict = (typeof getActiveConflictBetween === 'function') ? getActiveConflictBetween(server, team.getId(), targetTeam.getId()) : null
        var cId = existingConflict ? existingConflict.id : '?'
        sendMsg(player, 'Conflit', 'Un conflit #' + cId + ' est déjà en cours contre cette nation !', '§c')
        return 0
    }

    // 2. Condition essentielle : 1 joueur minimum connecté par camp
    if (typeof isAtLeastOneMemberOnline === 'function') {
        if (!isAtLeastOneMemberOnline(server, team.getId())) {
            sendMsg(player, 'Conflit', 'Aucun membre actif de votre nation n\'est disponible.', '§c')
            return 0
        }
        if (!isAtLeastOneMemberOnline(server, targetTeam.getId())) {
            sendMsg(player, 'Conflit', 'Impossible d\'engager le conflit : aucun joueur de la nation §e' + targetTeam.getName().getString() + ' §cn\'est actuellement connecté ! (Condition : 1 joueur minimum en ligne par camp)', '§c')
            return 0
        }
    }

    // 2b. Condition CTF : Les deux nations doivent posséder un Autel National configuré (/nation setaltar)
    if (typeof hasNationAltar === 'function') {
        if (!hasNationAltar(team.getId())) {
            sendMsg(player, 'Conflit', 'Votre nation n\'a pas encore configuré son Autel National (/nation setaltar) ! Impossible d\'engager un Conflit.', '§c')
            return 0
        }
        if (!hasNationAltar(targetTeam.getId())) {
            sendMsg(player, 'Conflit', 'La nation cible §e' + targetTeam.getName().getString() + ' §cn\'a pas encore configuré son Autel National (/nation setaltar) ! Impossible d\'engager un Conflit CTF.', '§c')
            return 0
        }
    }

    // 3. Condition financière : chaque banque doit avoir au moins 250 R
    if (typeof hasNationMoney === 'function') {
        if (!hasNationMoney(team, player, CONFLICT_COST)) {
            sendMsg(player, 'Conflit', 'Fonds insuffisants ! Le Trésor national de votre pays doit posséder au moins ' + CONFLICT_COST + ' R.', '§c')
            return 0
        }
        if (!hasNationMoney(targetTeam, null, CONFLICT_COST)) {
            sendMsg(player, 'Conflit', 'La nation cible ne dispose pas des ' + CONFLICT_COST + ' R requis dans son Trésor d\'État pour couvrir l\'escarmouche.', '§c')
            return 0
        }
    }



    // 4. Débit atomique des 250 R par camp
    var atkPaid = false
    if (typeof withdrawNationMoney === 'function') {
        atkPaid = withdrawNationMoney(team, player, CONFLICT_COST)
    }
    if (!atkPaid) {
        sendMsg(player, 'Conflit', 'Échec du prélèvement des ' + CONFLICT_COST + ' R sur votre Trésor national.', '§c')
        return 0
    }

    var defPaid = false
    if (typeof withdrawNationMoney === 'function') {
        defPaid = withdrawNationMoney(targetTeam, null, CONFLICT_COST)
    }
    if (!defPaid) {
        // Rollback immédiat de l'attaquant !
        if (typeof depositNationMoneyDirect === 'function') {
            depositNationMoneyDirect(team, CONFLICT_COST)
        }
        sendMsg(player, 'Conflit', 'Échec du prélèvement des ' + CONFLICT_COST + ' R sur la nation adverse. Vos fonds ont été recrédités.', '§c')
        return 0
    }

    // 5. Enregistrement du conflit
    var conflictId = getNextWarId(server)
    var wars = loadWarsRegistry(server)
    var now = Date.now()
    var countdownEndsAt = now + CONFLICT_WARMUP_MS
    var expiresAt = countdownEndsAt + CONFLICT_DURATION_MS
    var atkName = team.getName().getString()
    var defName = targetTeam.getName().getString()

    var newConflict = {
        id: conflictId,
        type: 'CONFLICT',
        status: 'COUNTDOWN',
        requesterUuid: player.getStringUuid ? player.getStringUuid() : player.uuid.toString(),
        attackerName: atkName,
        defenderName: defName,
        attackerTeamId: team.getId().toString(),
        defenderTeamId: targetTeam.getId().toString(),
        attackerLeader: team.getId().toString(),
        defenderLeader: targetTeam.getId().toString(),
        attackers: [team.getId().toString()],
        defenders: [targetTeam.getId().toString()],
        attackerNames: [atkName],
        defenderNames: [defName],
        escrowPool: CONFLICT_COST * 2, // 500 R
        costPaidPerTeam: CONFLICT_COST,
        createdAt: now,
        countdownEndsAt: countdownEndsAt,
        startedAt: null,
        expiresAt: expiresAt,
        winnerTeamId: null,
        endReason: null,
        flagCarrierUuid: null,
        carrierTeamId: null,
        lastReminderMinute: 60
    }
    setWar(wars, conflictId, newConflict)
    saveWarsRegistry(server, wars)

    // Rupture immédiate de l'alliance si alliés
    if (typeof isAllied === 'function' && isAllied(server, team.getId(), targetTeam.getId())) {
        if (typeof breakAlliance === 'function') {
            breakAlliance(server, team.getId(), targetTeam.getId(), 'conflict_start')
        }
    }

    // 6. Broadcast global et alertes sonores
    broadcastMsg(server, 'Conflit #' + conflictId, '§e' + atkName + ' §ca engagé un CONFLIT contre §e' + defName + ' §c! Pot en jeu : §6500 R§c. Début des combats dans §e5 minutes§c.', '§4')
    broadcastMsg(server, 'Règles Conflit', '§7Format Escarmouche 60 min : Casse manuelle activée, ZÉRO dégât d\'explosion, pillage des coffres interdit.', '§7')

    try {
        var pList = server.getPlayerList().getPlayers()
        for (var i = 0; i < pList.size(); i++) {
            var onlineP = pList.get(i)
            if (onlineP) onlineP.playNotifySound('minecraft:ui.toast.challenge_complete', 'master', 1.0, 1.0)
        }
    } catch (se) { }

    return 1
}

/**
 * Clôture un conflit par la victoire d'un camp (CTF réussi ou décision d'arbitrage)
 */
function resolveConflictVictory(server, conflictId, winnerTeamId) {
    if (!server || !conflictId) return false
    var wars = loadWarsRegistry(server)
    var c = getWar(wars, conflictId)
    if (!c || c.type !== 'CONFLICT' || c.status === 'ENDED') return false

    var winnerTeam = getTeamById(server, winnerTeamId)
    if (!winnerTeam) return false

    var pool = c.escrowPool || (CONFLICT_COST * 2)
    c.status = 'ENDED'
    c.endedAt = Date.now()
    c.winnerTeamId = winnerTeam.getId().toString()
    c.endReason = 'VICTORY'
    setWar(wars, c.id, c)
    saveWarsRegistry(server, wars)

    // Créditer les 500 R au Trésor national de l'équipe gagnante
    if (typeof depositNationMoneyDirect === 'function') {
        depositNationMoneyDirect(winnerTeam, pool)
    }

    if (typeof resetNationAltarFlag === 'function') {
        resetNationAltarFlag(server, c.defenderTeamId || c.defenderLeader)
    }
    if (typeof removeAllConflictFlags === 'function') {
        removeAllConflictFlags(server, c.id)
    }
    if (typeof revokeAllWarBypasses === 'function') {
        revokeAllWarBypasses(server)
    }

    var winnerName = winnerTeam.getName().getString()
    var loserName = (c.attackerTeamId === winnerTeam.getId().toString()) ? c.defenderName : c.attackerName

    broadcastMsg(server, 'Victoire Conflit #' + c.id, '§6' + winnerName + ' §aa remporté le Conflit contre §e' + loserName + ' §a! La prime de §6' + pool + ' R §adu pot commun a été versée à leur Trésor national !', '§2')

    if (typeof TW_UpdateLeaderboards === 'function') {
        try { TW_UpdateLeaderboards(server) } catch (eLb) { }
    }

    try {
        var pList = server.getPlayerList().getPlayers()
        for (var i = 0; i < pList.size(); i++) {
            var onlineP = pList.get(i)
            if (onlineP) onlineP.playNotifySound('minecraft:ui.toast.challenge_complete', 'master', 1.0, 1.0)
        }
    } catch (se) { }

    return true
}

/**
 * Clôture un conflit en Victoire Défensive (expiration du chrono de 60 min sans capture)
 */
function resolveConflictDefensiveVictory(server, conflictId) {
    if (!server || !conflictId) return false
    var wars = loadWarsRegistry(server)
    var c = getWar(wars, conflictId)
    if (!c || c.type !== 'CONFLICT' || c.status === 'ENDED') return false

    var defTeamId = c.defenderTeamId || c.defenderLeader
    var defTeam = getTeamById(server, defTeamId)
    if (!defTeam) return false

    var pool = c.escrowPool || (CONFLICT_COST * 2)
    c.status = 'ENDED'
    c.endedAt = Date.now()
    c.winnerTeamId = defTeam.getId().toString()
    c.endReason = 'DEFENSIVE_VICTORY'
    setWar(wars, c.id, c)
    saveWarsRegistry(server, wars)

    // Créditer les 500 R au Trésor national du défenseur
    if (typeof depositNationMoneyDirect === 'function') {
        depositNationMoneyDirect(defTeam, pool)
    }

    if (typeof resetNationAltarFlag === 'function') {
        resetNationAltarFlag(server, defTeamId)
    }
    if (typeof removeAllConflictFlags === 'function') {
        removeAllConflictFlags(server, c.id)
    }
    if (typeof revokeAllWarBypasses === 'function') {
        revokeAllWarBypasses(server)
    }

    var defName = defTeam.getName().getString()
    broadcastMsg(server, 'Victoire Conflit #' + c.id, '§6' + defName + ' §aa vaillamment repoussé l\'assaut et protégé son Étendard pendant 60 minutes ! §a§lVICTOIRE DÉFENSIVE ! §fLa prime de §6' + pool + ' R §fdu pot commun a été versée à leur Trésor national !', '§2')

    if (typeof TW_UpdateLeaderboards === 'function') {
        try { TW_UpdateLeaderboards(server) } catch (eLb) { }
    }

    try {
        var pListD = server.getPlayerList().getPlayers()
        for (var d = 0; d < pListD.size(); d++) {
            var onlinePD = pListD.get(d)
            if (onlinePD) onlinePD.playNotifySound('minecraft:ui.toast.challenge_complete', 'master', 1.0, 1.0)
        }
    } catch (seD) { }

    return true
}

/**
 * Clôture un conflit en Match Nul (arbitrage admin ou cas exceptionnel)
 */
function resolveConflictDraw(server, conflictId) {
    if (!server || !conflictId) return false
    var wars = loadWarsRegistry(server)
    var c = getWar(wars, conflictId)
    if (!c || c.type !== 'CONFLICT' || c.status === 'ENDED') return false

    var pool = c.escrowPool || (CONFLICT_COST * 2)
    c.status = 'ENDED'
    c.endedAt = Date.now()
    c.winnerTeamId = null
    c.endReason = 'DRAW'
    setWar(wars, c.id, c)
    saveWarsRegistry(server, wars)

    if (typeof resetNationAltarFlag === 'function') {
        resetNationAltarFlag(server, c.defenderTeamId || c.defenderLeader)
    }
    if (typeof removeAllConflictFlags === 'function') {
        removeAllConflictFlags(server, c.id)
    }
    if (typeof revokeAllWarBypasses === 'function') {
        revokeAllWarBypasses(server)
    }

    broadcastMsg(server, 'Conflit #' + c.id, 'Le match entre §e' + c.attackerName + ' §fet §e' + c.defenderName + ' §fse termine par un §eMATCH NUL§f. Le pot de §6' + pool + ' R §fest conservé par l\'ONU.', '§6')

    return true
}

/**
 * Annule un conflit (avec remboursement optionnel des deux camps)
 */
function cancelConflict(server, conflictId, refundBoth, reason) {
    if (!server || !conflictId) return false
    var wars = loadWarsRegistry(server)
    var c = getWar(wars, conflictId)
    if (!c || c.type !== 'CONFLICT' || c.status === 'ENDED') return false

    c.status = 'ENDED'
    c.endedAt = Date.now()
    c.winnerTeamId = null
    c.endReason = 'CANCELLED'

    if (refundBoth && typeof depositNationMoneyDirect === 'function') {
        var aTeam = getTeamById(server, c.attackerTeamId || c.attackerLeader)
        var dTeam = getTeamById(server, c.defenderTeamId || c.defenderLeader)
        var refundAmount = c.costPaidPerTeam || CONFLICT_COST
        if (aTeam) depositNationMoneyDirect(aTeam, refundAmount)
        if (dTeam) depositNationMoneyDirect(dTeam, refundAmount)
    }

    if (typeof resetNationAltarFlag === 'function') {
        resetNationAltarFlag(server, c.defenderTeamId || c.defenderLeader)
    }
    if (typeof removeAllConflictFlags === 'function') {
        removeAllConflictFlags(server, c.id)
    }
    if (typeof revokeAllWarBypasses === 'function') {
        revokeAllWarBypasses(server)
    }

    setWar(wars, c.id, c)
    saveWarsRegistry(server, wars)

    var msg = 'Le conflit #' + c.id + ' entre §e' + c.attackerName + ' §fet §e' + c.defenderName + ' §fa été arrêté.'
    if (reason) msg += ' (Raison : ' + reason + ')'
    if (refundBoth) msg += ' [250 R remboursés à chaque nation]'
    broadcastMsg(server, 'Conflit', msg, '§e')
    return true
}

/**
 * Gestion temporelle cadencée des conflits (préavis 5 min, rappels chrono, fin 60 min)
 */
function checkConflictsTick(server) {
    if (!server) return
    var wars = loadWarsRegistry(server)
    var now = Date.now()
    var changed = false

    for (var id in wars) {
        var w = getWar(wars, id)
        if (!w || w.type !== 'CONFLICT') continue

        // 1. Préavis de 5 minutes (COUNTDOWN -> ACTIVE)
        if (w.status === 'COUNTDOWN') {
            if (now >= w.countdownEndsAt) {
                w.status = 'ACTIVE'
                w.startedAt = now
                w.expiresAt = now + CONFLICT_DURATION_MS
                w.lastReminderMinute = 60
                changed = true

                // Matérialiser l'Étendard physique sur l'autel du défenseur
                var defAltarPosMsg = ''
                try {
                    var defAltar = (typeof getNationAltar === 'function') ? getNationAltar(w.defenderTeamId) : null
                    if (defAltar) {
                        if (typeof spawnPhysicalFlagBlock === 'function') {
                            spawnPhysicalFlagBlock(server, defAltar)
                        }
                        defAltarPosMsg = ' §7(Autel ennemi en §eX: ' + defAltar.x + ', Y: ' + (defAltar.y + 1) + ', Z: ' + defAltar.z + '§7)'
                    }
                } catch (afe) { }

                broadcastMsg(server, 'Conflit #' + w.id, '§c§lLE CONFLIT COMMENCE ! §fL\'affrontement entre §e' + w.attackerName + ' §fet §e' + w.defenderName + ' §fest désormais §c§lACTIF§f pour §e60 minutes§f !' + defAltarPosMsg, '§c')
                try {
                    var pList = server.getPlayerList().getPlayers()
                    for (var i = 0; i < pList.size(); i++) {
                        var p = pList.get(i)
                        if (p) p.playNotifySound('minecraft:entity.ender_dragon.growl', 'master', 0.8, 1.2)
                    }
                } catch (e) { }
            } else {
                var remMs = w.countdownEndsAt - now
                var remSec = Math.round(remMs / 1000)
                if (remSec === 60 && !w.warned1Min) {
                    w.warned1Min = true
                    changed = true
                    broadcastMsg(server, 'Conflit #' + w.id, 'Début des combats entre §e' + w.attackerName + ' §fet §e' + w.defenderName + ' §fdans §e1 minute§f ! Préparez vos défenses.', '§e')
                }
            }
        }
        // 2. Phase de combat active (60 min)
        else if (w.status === 'ACTIVE') {
            if (now >= w.expiresAt) {
                resolveConflictDefensiveVictory(server, w.id)
                changed = true
            } else {
                var remMin = Math.ceil((w.expiresAt - now) / 60000)
                if (remMin !== w.lastReminderMinute && (remMin === 30 || remMin === 15 || remMin === 5 || remMin === 1)) {
                    w.lastReminderMinute = remMin
                    changed = true
                    var col = (remMin <= 5) ? '§c' : '§6'
                    broadcastMsg(server, 'Chrono Conflit #' + w.id, col + 'Il reste ' + remMin + ' minute' + (remMin > 1 ? 's' : '') + ' avant la fin du match entre §e' + w.attackerName + ' §fet §e' + w.defenderName + ' §f(Pot: §6' + (w.escrowPool || 500) + ' R§f).', col)
                }
            }
        }
    }

    if (changed) {
        saveWarsRegistry(server, wars)
    }
}

/**
 * Affiche la fiche détaillée d'une guerre ou d'un conflit
 */
function showWarInfo(player, query) {
    if (!player) return 0
    var server = player.server
    var w = findWarQuery(server, query, false)
    if (!w) {
        sendMsg(player, 'Guerre/Conflit', 'Aucun enregistrement trouvé pour : "' + (query || '') + '". Tapez /war list', '§c')
        return 0
    }

    var isConflict = (w.type === 'CONFLICT')
    var title = isConflict ? 'Conflit #' + w.id : 'Guerre #' + w.id
    sendMsg(player, title, '--- Fiche Détaillée ---', '§6')
    sendMsg(player, title, 'Type : §e' + (isConflict ? 'Conflit (Escarmouche CTF)' : 'Guerre Formelle (Siège lourd)'), '§7')
    sendMsg(player, title, 'Belligérants : §e' + (w.attackerName || 'Attaquant') + ' §fcontre §9' + (w.defenderName || 'Défenseur'), '§7')

    var now = Date.now()
    if (w.status === 'COUNTDOWN') {
        var remSec = Math.max(0, Math.round((w.countdownEndsAt - now) / 1000))
        sendMsg(player, title, 'Statut : §ePRÉAVIS §7(Début des combats dans §e' + remSec + 's§7)', '§e')
    } else if (w.status === 'ACTIVE') {
        if (isConflict && w.expiresAt) {
            var remMin = Math.max(0, Math.ceil((w.expiresAt - now) / 60000))
            sendMsg(player, title, 'Statut : §c§lACTIF §7(Temps restant : §e' + remMin + ' min§7)', '§c')
        } else {
            sendMsg(player, title, 'Statut : §c§lACTIF', '§c')
        }
    } else if (w.status === 'PENDING_ADMIN') {
        sendMsg(player, title, 'Statut : §eEN ATTENTE DE VALIDATION STAFF', '§e')
    } else {
        var reason = w.endReason ? ' (' + w.endReason + ')' : ''
        sendMsg(player, title, 'Statut : §7TERMINÉE' + reason, '§7')
        if (w.winnerTeamId) {
            sendMsg(player, title, 'Vainqueur : §a' + getTeamDisplayName(server, w.winnerTeamId), '§a')
        }
    }

    if (isConflict) {
        sendMsg(player, title, 'Pot séquestré : §6' + (w.escrowPool || 500) + ' R', '§7')
        sendMsg(player, title, 'Attaquant : §e' + (w.attackerName || 'Attaquant') + ' §7(Mission : Extraire l\'Étendard adverse et le livrer à l\'ONU)', '§7')
        sendMsg(player, title, 'Défenseur : §e' + (w.defenderName || 'Défenseur') + ' §7(Mission : Protéger l\'autel pendant 60 min pour remporter les 500 R)', '§7')
        if (typeof getNationAltar === 'function') {
            var defAltar = getNationAltar(w.defenderTeamId || w.defenderLeader)
            if (defAltar) {
                sendMsg(player, title, 'Autel Défenseur : §eX: ' + defAltar.x + ', Y: ' + defAltar.y + ', Z: ' + defAltar.z + ' §7(Statut: ' + defAltar.status + ')', '§e')
            }
        }
        sendMsg(player, title, 'Règles : Casse manuelle ON | Explosions 0% | Pillage coffres OFF', '§7')
    } else {
        sendMsg(player, title, 'Raid Hours : ' + getRaidHoursStatusText(), '§7')
        sendMsg(player, title, 'Règles : Casse manuelle ON | Explosions ON (sauf Sanctuaires) | Pillage coffres ON', '§7')
    }

    return 1
}

function listActiveWars(player) {
    if (!player) return 0
    var server = player.server
    var wars = loadWarsRegistry(server)
    var conflictCount = 0
    var warCount = 0
    var now = Date.now()

    sendMsg(player, 'Registre', '=== AFFRONTEMENTS EN COURS ===', '§6')

    // 1. Conflits d'Escarmouche (CTF)
    sendMsg(player, 'Conflits', '--- Conflits d\'Escarmouche (CTF 60 min) ---', '§e')
    for (var cId in wars) {
        if (!wars.hasOwnProperty(cId)) continue
        var c = getWar(wars, cId)
        if (!c || c.type !== 'CONFLICT') continue
        if (c.status !== 'ACTIVE' && c.status !== 'COUNTDOWN') continue
        conflictCount++

        var cStatus = ''
        if (c.status === 'COUNTDOWN') {
            var remSec = Math.max(0, Math.round((c.countdownEndsAt - now) / 1000))
            cStatus = '§e[PRÉAVIS ' + remSec + 's]'
        } else {
            var remMin = Math.max(0, Math.ceil((c.expiresAt - now) / 60000))
            cStatus = '§c[ACTIF ' + remMin + 'm]'
        }

        sendMsg(player, 'Conflit #' + c.id, cStatus + ' §e' + c.attackerName + ' §fVS §9' + c.defenderName + ' §7| Pot: §6' + (c.escrowPool || 500) + ' R', '§e')
    }
    if (conflictCount === 0) {
        sendMsg(player, 'Conflits', 'Aucun conflit en cours. (/war conflict <nation>)', '§7')
    }

    // 2. Guerres Déclarées (Sièges)
    sendMsg(player, 'Guerres', '--- Guerres Déclarées (Sièges) ---', '§c')
    for (var id in wars) {
        if (!wars.hasOwnProperty(id)) continue
        var w = getWar(wars, id)
        if (!w || w.type === 'CONFLICT') continue
        if (w.status !== 'ACTIVE' && w.status !== 'PENDING_ADMIN') continue
        warCount++

        var atkNames = []
        if (w.attackerNames && w.attackerNames.length > 0) atkNames = w.attackerNames
        else atkNames.push(w.attackerName || 'Inconnu')

        var defNames = []
        if (w.defenderNames && w.defenderNames.length > 0) defNames = w.defenderNames
        else defNames.push(w.defenderName || 'Inconnu')

        var statusLabel = (w.status === 'ACTIVE') ? '§c§lACTIF' : '§e§lEN ATTENTE STAFF'
        sendMsg(player, 'Guerre #' + id, statusLabel + ' §7| §e' + atkNames.join('§7, §e') + ' §fcontre §9' + defNames.join('§7, §9'), '§6')
    }
    if (warCount === 0) {
        sendMsg(player, 'Guerres', 'Aucune guerre déclarée en cours.', '§7')
    }

    try {
        var warsList = []
        for (var wid in wars) {
            if (!wars.hasOwnProperty(wid)) continue
            var warObj = getWar(wars, wid)
            if (!warObj) continue
            if (warObj.status === 'ACTIVE' || warObj.status === 'PENDING_ADMIN' || warObj.status === 'COUNTDOWN') {
                warsList.push({
                    id: warObj.id,
                    type: warObj.type || 'WAR',
                    attacker: warObj.attackerName || 'Attaquant',
                    defender: warObj.defenderName || 'Défenseur',
                    status: warObj.status,
                    escrowPool: warObj.escrowPool || 0,
                    coalitionCount: ((warObj.attackers ? warObj.attackers.length : 1) + (warObj.defenders ? warObj.defenders.length : 1))
                })
            }
        }
        var isRaidActive = false
        if (typeof isRaidHourActive === 'function') {
            isRaidActive = isRaidHourActive(server)
        }
        var warPayload = {
            raidHoursActive: isRaidActive,
            activeWars: warsList
        }
        player.sendData('open_war_registry', { json: JSON.stringify(warPayload) })
    } catch (we) { }

    return 1
}

NetworkEvents.dataReceived('action_war', function (event) {
    try {
        var player = event.player || event.getEntity()
        if (!player) return
        var data = event.data || event.getData()
        var raw = data.getString ? data.getString('json') : String(data.get('json'))
        if (!raw) return
        var action = JSON.parse(raw)
        if (action.action === 'peace' && action.warId) {
            var wars = loadWarsRegistry(player.server)
            var w = getWar(wars, action.warId)
            if (w) {
                handleWarPeace(player, w.attackerName || w.defenderName)
            }
        } else if (action.action === 'prompt_declare') {
            sendMsg(player, 'Guerre', 'Pour déclarer une guerre, tapez : §e/war declare <NomDeLaNation>', '§e')
        }
    } catch (e) { }
})

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// TICK PÉRIODIQUE DES GUERRES & CONFLITS VIA MASTER SCHEDULER (CHAQUE SECONDE)
// -----------------------------------------------------------------------------
if (typeof TW_Scheduler !== 'undefined' && TW_Scheduler.register) {
    TW_Scheduler.register('war_system_tick', 20, function (server) {
        if (typeof checkCallsToArmsExpiration === 'function') {
            checkCallsToArmsExpiration(server);
        }
        if (typeof checkConflictsTick === 'function') {
            checkConflictsTick(server);
        }
    });
}
