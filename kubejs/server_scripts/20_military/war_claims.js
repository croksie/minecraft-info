// priority: 45
// =============================================================================
// Third World Server Script - Contrôle des Claims FTB Chunks & Dégâts de Siège
// =============================================================================

var warBypassedPlayers = {} // { [playerUuidStr]: true }
var playerWarBypassExpiry = {} // { [playerUuidStr]: timestamp }


/**
 * Vérifie si l'explosion provient d'un mob vanilla (Creeper, Wither, Ghast fireball, etc.)
 */
function isVanillaMobExplosion(exploder) {
    if (!exploder) return false
    try {
        // Si l'auteur direct ou son propriétaire est un joueur, ce n'est pas un mob
        if (exploder.isPlayer && exploder.isPlayer()) return false
        if (exploder.getOwner && exploder.getOwner()) {
            var owner = exploder.getOwner()
            if (owner.isPlayer && owner.isPlayer()) return false
        }

        var typeStr = exploder.getType ? String(exploder.getType().toString()).toLowerCase() : (exploder.type ? String(exploder.type).toLowerCase() : '')

        // Mobs / projectiles vanilla explosifs
        if (typeStr.indexOf('creeper') !== -1 ||
            typeStr.indexOf('wither_skull') !== -1 ||
            typeStr.indexOf('fireball') !== -1 ||
            typeStr.indexOf('wither') !== -1) {
            return true
        }

        // Vérification via la détection hostile ONU si disponible
        if (typeof isHostileMob === 'function' && isHostileMob(exploder)) {
            return true
        }
        if (exploder.getOwner && typeof isHostileMob === 'function' && isHostileMob(exploder.getOwner())) {
            return true
        }

        // Vérification Java standard net.minecraft.world.entity.Mob
        if (typeStr.startsWith('minecraft:') && typeStr !== 'minecraft:tnt' && typeStr !== 'minecraft:tnt_minecart') {
            try {
                var MobClass = Java.loadClass('net.minecraft.world.entity.Mob')
                if (MobClass && MobClass.isAssignableFrom(exploder.getClass())) {
                    return true
                }
            } catch (je) { }
        }
    } catch (e) {
        console.error('[WarClaims] Erreur isVanillaMobExplosion : ' + e)
    }
    return false
}

/**
 * Vérifie si le joueur est un administrateur en mode Créatif (bâtisseur/staff)
 */
function isCreativeAdmin(player) {
    // Les admins et le mode créatif n'ont pas de superpouvoir pour casser les chunks claims
    return false
}

/**
 * Récupère la dimension Level sous forme de ResourceKey sécurisée
 */
function getLevelDimKey(level) {
    if (!level) {
        var LevelClass = Java.loadClass('net.minecraft.world.level.Level')
        return LevelClass.OVERWORLD
    }
    try {
        if (typeof level.dimension === 'function') return level.dimension()
        if (level.dimension) return level.dimension
    } catch (e) { }
    var LevelClass = Java.loadClass('net.minecraft.world.level.Level')
    return LevelClass.OVERWORLD
}

/**
 * Vérifie si le monde courant est l'Overworld de façon sécurisée
 */
function isLevelOverworld(level) {
    if (!level) return true
    try {
        var dimKey = (typeof level.dimension === 'function') ? level.dimension() : level.dimension
        if (dimKey) {
            var loc = null
            if (typeof dimKey.location === 'function') loc = String(dimKey.location())
            else if (dimKey.location) loc = String(dimKey.location)
            else loc = String(dimKey)
            return loc.toLowerCase().indexOf('overworld') !== -1
        }
    } catch (e) { }
    return true
}

/**
 * Récupère l'équipe propriétaire du chunk à des coordonnées précises
 */
function getChunkOwningTeam(level, blockX, blockZ) {
    try {
        var chunksApi = Java.loadClass('dev.ftb.mods.ftbchunks.api.FTBChunksAPI').api()
        if (!chunksApi || !chunksApi.isManagerLoaded()) return null
        var chunkMgr = chunksApi.getManager()
        if (!chunkMgr) return null

        var chunkX = blockX >> 4
        var chunkZ = blockZ >> 4
        var dimKey = getLevelDimKey(level)

        var ChunkDimPosClass = Java.loadClass('dev.ftb.mods.ftblibrary.math.ChunkDimPos')
        var chunkDimPos = new ChunkDimPosClass(dimKey, chunkX, chunkZ)
        var claimedChunk = chunkMgr.getChunk(chunkDimPos)
        if (!claimedChunk || !claimedChunk.getTeamData()) return null

        return claimedChunk.getTeamData().getTeam()
    } catch (e) {
        return null
    }
}

/**
 * Active ou désactive le contournement FTB Chunks accordé temporairement par le système de guerre
 */
function setPlayerWarBypass(player, enable) {
    if (!player) return
    try {
        var chunksApi = Java.loadClass('dev.ftb.mods.ftbchunks.api.FTBChunksAPI').api()
        if (!chunksApi || !chunksApi.isManagerLoaded()) return
        var chunkMgr = chunksApi.getManager()
        if (!chunkMgr) return

        var pUuid = (typeof getPlayerUUID === 'function') ? getPlayerUUID(player) : (player.getUUID ? player.getUUID() : player.getUuid())
        if (!pUuid) return
        var uuidStr = pUuid.toString()

        if (enable) {
            if (!chunkMgr.getBypassProtection(pUuid)) {
                chunkMgr.setBypassProtection(pUuid, true)
            }
            warBypassedPlayers[uuidStr] = true
            playerWarBypassExpiry[uuidStr] = Date.now() + 15000 // Fenêtre de siège de 15 secondes
        } else {
            delete warBypassedPlayers[uuidStr]
            delete playerWarBypassExpiry[uuidStr]
            chunkMgr.setBypassProtection(pUuid, false)
        }
    } catch (e) {
        console.error('[WarClaimsHook] Erreur setPlayerWarBypass : ' + e)
    }
}

/**
 * Révoque immédiatement le bypass FTB Chunks de guerre pour TOUS les joueurs connectés
 */
function revokeAllWarBypasses(server) {
    if (!server) return
    try {
        warBypassedPlayers = {}
        playerWarBypassExpiry = {}

        var chunksApi = null
        try {
            chunksApi = Java.loadClass('dev.ftb.mods.ftbchunks.api.FTBChunksAPI').api()
        } catch (ce) { }
        var chunkMgr = (chunksApi && chunksApi.isManagerLoaded()) ? chunksApi.getManager() : null

        var players = server.getPlayerList().getPlayers()
        for (var i = 0; i < players.size(); i++) {
            var p = players.get(i)
            if (!p) continue
            var pUuid = (typeof getPlayerUUID === 'function') ? getPlayerUUID(p) : (p.getUUID ? p.getUUID() : p.getUuid())
            if (chunkMgr && pUuid && !p.isCreative()) {
                try {
                    chunkMgr.setBypassProtection(pUuid, false)
                } catch (pe) { }
            }
        }
    } catch (err) {
        console.error('[WarClaims] Erreur revokeAllWarBypasses : ' + err)
    }
}

/**
 * Synchronise les permissions d'explosion FTB Chunks selon l'état des guerres et des Raid Hours
 */
function updateWarExplosionPermissions(server) {
    if (!server) return
    try {
        var wars = (typeof loadWarsRegistry === 'function') ? loadWarsRegistry(server) : null
        if (!wars) return

        var isRaid = (typeof isRaidHourActive === 'function' && isRaidHourActive())
        var FTBChunksProperties = Java.loadClass('dev.ftb.mods.ftbchunks.api.FTBChunksProperties')

        // Identifier les équipes en guerre formelle active
        var teamsInActiveWar = {}
        for (var id in wars) {
            var w = (typeof getWar === 'function') ? getWar(wars, id) : wars[id]
            if (!w || w.type !== 'WAR' || w.status !== 'ACTIVE') continue

            var atkId = w.attackerTeamId || w.attackerLeader
            var defId = w.defenderTeamId || w.defenderLeader
            if (atkId) teamsInActiveWar[String(atkId)] = true
            if (defId) teamsInActiveWar[String(defId)] = true
        }

        var teamsApi = Java.loadClass('dev.ftb.mods.ftbteams.api.FTBTeamsAPI').api()
        if (!teamsApi || !teamsApi.isManagerLoaded()) return
        var mgr = teamsApi.getManager()
        if (!mgr) return

        var allTeams = mgr.getTeams()
        var it = allTeams.iterator()
        while (it.hasNext()) {
            var team = it.next()
            if (!team) continue
            var tIdStr = String(team.getId())

            // L'ONU reste toujours 100% protégée contre les explosions
            var shortName = team.getShortName ? String(team.getShortName()).toLowerCase() : ''
            if (shortName === 'onu' || tIdStr === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
                try { team.setProperty(FTBChunksProperties.ALLOW_EXPLOSIONS, false) } catch (pe1) { }
                continue
            }

            var shouldAllow = isRaid && (teamsInActiveWar[tIdStr] === true)
            try {
                team.setProperty(FTBChunksProperties.ALLOW_EXPLOSIONS, shouldAllow)
            } catch (pe2) { }
        }
    } catch (err) {
        console.error('[WarClaims] Erreur updateWarExplosionPermissions : ' + err)
    }
}

/**
 * Détermine si une action de guerre (minage / pose / interaction) est autorisée sur ce bloc
 */
function shouldAllowWarAction(player, level, blockX, blockZ) {
    if (!player || !level) return false
    var server = level.server
    if (!server) return false

    // 1. Zone du Hub ONU : Protection absolue et inviolable
    if (isLevelOverworld(level)) {
        if (typeof isPositionInOnuClaim === 'function' && isPositionInOnuClaim(level, blockX, blockZ)) {
            return false
        }
    }

    var defendingTeam = getChunkOwningTeam(level, blockX, blockZ)
    if (!defendingTeam) return false // Zone sauvage libre

    // Si c'est le territoire officiel de l'ONU : invulnérabilité absolue
    var sName = defendingTeam.getShortName() ? String(defendingTeam.getShortName()).toLowerCase() : ''
    if (sName === 'onu' || String(defendingTeam.getId()) === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
        return false
    }

    // 2. Vérifier si l'attaquant appartient à une nation ennemie
    var attackingTeam = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(player) : null
    if (!attackingTeam) return false

    if (String(attackingTeam.getId()) === String(defendingTeam.getId())) {
        return false // Même équipe (géré par les droits internes de la nation)
    }

    // 2a. Cas Conflit CTF : casse manuelle autorisée dès que le conflit est ACTIVE (même hors Raid Hours)
    if (typeof getActiveConflictBetween === 'function') {
        var conflict = getActiveConflictBetween(server, attackingTeam.getId(), defendingTeam.getId())
        if (conflict) {
            if (conflict.status === 'ACTIVE') return true
            return false // En préavis COUNTDOWN : pas encore de casse
        }
    }

    // 2b. Cas Guerre Formelle : guerre active déclarée requise
    if (typeof isNationAtWarWith !== 'function' || !isNationAtWarWith(server, attackingTeam.getId(), defendingTeam.getId())) {
        return false // Pas en guerre
    }

    // 3. Période de raid obligatoire (18h-22h) pour les guerres de siège
    if (typeof isRaidHourActive === 'function' && !isRaidHourActive()) {
        return false // Hors Raid Hours
    }

    return true
}

// -----------------------------------------------------------------------------
// 1. DÉTECTION & BYPASS DYNAMIQUE EN TEMPS DE GUERRE
// -----------------------------------------------------------------------------

// Dès que le joueur donne un coup ou commence à casser un bloc ennemi
BlockEvents.leftClicked(function (event) {
    try {
        var player = event.player
        if (!player || player.isFake()) return
        var level = event.level
        if (!level || level.isClientSide()) return
        var server = level.server
        var pos = event.block.getPos()
        var bx = pos.getX()
        var by = pos.getY()
        var bz = pos.getZ()

        // Détection de frappe directe sur l'Autel ou l'Étendard adverse
        if (typeof loadAltarsData === 'function') {
            var altars = loadAltarsData()
            for (var tId in altars) {
                var a = altars[tId]
                if (a && a.x === bx && (by >= a.y && by <= (a.y + 2)) && a.z === bz) {
                    if (typeof tryStealFlag === 'function') {
                        var stolen = tryStealFlag(server, player, tId, a)
                        if (stolen) {
                            event.cancel()
                            return
                        }
                    }
                }
            }
        }

        if (shouldAllowWarAction(player, level, bx, bz)) {
            setPlayerWarBypass(player, true)
        }
    } catch (e) { }
})

// Vérification continue pour les joueurs en zone ennemie pendant les Raid Hours via Master Scheduler
if (typeof TW_Scheduler !== 'undefined' && TW_Scheduler.register) {
    TW_Scheduler.register('war_claims_bypass', 20, function (server) {
        try {
            if (!server) return

            var now = Date.now()

            // Synchroniser les permissions d'explosion FTB Chunks (guerres actives + Raid Hours)
            try {
                updateWarExplosionPermissions(server)
            } catch (uepErr) { }

            var players = server.getPlayerList().getPlayers()
            for (var i = 0; i < players.size(); i++) {
                var p = players.get(i)
                if (!p || p.isFake()) continue
                var lvl = p.level
                if (!lvl) continue
                var px = Math.floor(p.x)
                var pz = Math.floor(p.z)

                var pUuid = (typeof getPlayerUUID === 'function') ? getPlayerUUID(p) : (p.getUUID ? p.getUUID() : p.getUuid())
                var uuidStr = pUuid ? pUuid.toString() : null
                if (!uuidStr) continue

                var allowAction = shouldAllowWarAction(p, lvl, px, pz)

                // Si action de guerre autorisée (Conflit CTF actif ou Siège en Raid Hours)
                if (allowAction) {
                    setPlayerWarBypass(p, true)
                } else {
                    // Si action non autorisée et fenêtre de 15s expirée, révoquer le bypass
                    var expiry = playerWarBypassExpiry[uuidStr] || 0
                    if (now > expiry || !warBypassedPlayers[uuidStr]) {
                        if (warBypassedPlayers[uuidStr]) {
                            setPlayerWarBypass(p, false)
                        }
                        try {
                            var chunksApi = Java.loadClass('dev.ftb.mods.ftbchunks.api.FTBChunksAPI').api()
                            if (chunksApi && chunksApi.isManagerLoaded()) {
                                var chunkMgr = chunksApi.getManager()
                                if (chunkMgr && pUuid && !p.isCreative() && chunkMgr.getBypassProtection(pUuid)) {
                                    chunkMgr.setBypassProtection(pUuid, false)
                                }
                            }
                        } catch (be) { }
                    }
                }
            }
        } catch (te) { }
    })
}


PlayerEvents.loggedOut(function (event) {
    try {
        var player = event.player
        if (player) setPlayerWarBypass(player, false)
    } catch (e) { }
})

// =============================================================================
// BLOCS ÉVÉNEMENTS : GESTION DES DÉGÂTS DE SIÈGE & BYPASS FTB
// =============================================================================

// -----------------------------------------------------------------------------
// 2. CONTRÔLE STRICT DU MINAGE (BlockEvents.broken)
// -----------------------------------------------------------------------------
BlockEvents.broken(function (event) {
    try {
        var player = event.player
        if (!player || player.isFake()) return
        var level = event.level
        if (!level || level.isClientSide()) return
        var server = level.server

        var pos = event.block.getPos()
        var bx = pos.getX()
        var by = pos.getY()
        var bz = pos.getZ()

        // Protection de l'Autel National et de son Étendard contre la destruction
        if (typeof loadAltarsData === 'function') {
            var altars = loadAltarsData()
            for (var tId in altars) {
                var a = altars[tId]
                if (a && a.x === bx && (by >= a.y && by <= (a.y + 2)) && a.z === bz) {
                    event.cancel()
                    if (typeof tryStealFlag === 'function') {
                        var stolen = tryStealFlag(server, player, tId, a)
                        if (stolen) return
                    }
                    sendMsg(player, 'Autel National', 'L\'Autel National et son Étendard sont scellés et protégés ! (/nation altar)', '§c')
                    return
                }
            }
        }

        // Protection inviolable de l'ONU
        if (isLevelOverworld(level)) {
            if (typeof isPositionInOnuClaim === 'function' && isPositionInOnuClaim(level, bx, bz)) {
                event.cancel()
                return
            }
        }

        var defendingTeam = getChunkOwningTeam(level, bx, bz)
        if (!defendingTeam) return // Zone sauvage libre

        var sName = defendingTeam.getShortName() ? String(defendingTeam.getShortName()).toLowerCase() : ''
        if (sName === 'onu' || String(defendingTeam.getId()) === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
            event.cancel()
            return
        }

        var attackingTeam = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(player) : null
        if (attackingTeam && String(attackingTeam.getId()) === String(defendingTeam.getId())) {
            return // Membre de sa propre nation
        }

        // 1. Vérification de Conflit CTF
        if (attackingTeam && typeof getActiveConflictBetween === 'function') {
            var conflict = getActiveConflictBetween(server, attackingTeam.getId(), defendingTeam.getId())
            if (conflict) {
                if (conflict.status === 'ACTIVE') {
                    // MINAGE MANUEL AUTORISÉ EN CONFLIT (MÊME HORS RAID HOURS !)
                    setPlayerWarBypass(player, true)
                    return
                } else if (conflict.status === 'COUNTDOWN') {
                    var now = Date.now()
                    var remSec = Math.max(0, Math.round(((conflict.countdownEndsAt || now) - now) / 1000))
                    sendMsg(player, 'Conflit', 'Le préavis est en cours ! Début des combats et du minage dans ' + remSec + 's.', '§e')
                    event.cancel()
                    return
                }
            }
        }

        // 2. Vérification de guerre déclarée (Siège)
        if (attackingTeam && typeof isNationAtWarWith === 'function' && isNationAtWarWith(server, attackingTeam.getId(), defendingTeam.getId())) {
            if (typeof isRaidHourActive === 'function' && isRaidHourActive()) {
                // MINAGE AUTORISÉ DANS LES CHUNKS ENNEMIS PENDANT LES RAID HOURS !
                setPlayerWarBypass(player, true)
                return
            } else {
                sendMsg(player, 'Guerre', 'Le minage en territoire ennemi n\'est autorisé que pendant les Raid Hours (18h-22h) ! Tapez §e/war raidhours force §cpour tester en tant que Staff.', '§c')
                event.cancel()
                return
            }
        }

        // Si le joueur n'est ni en conflit ni en guerre contre cette nation, annulation ferme
        sendMsg(player, 'Territoire', 'Ce territoire appartient à §6' + defendingTeam.getName().getString() + '§c. Vous n\'êtes pas en guerre ni en conflit !', '§c')
        event.cancel()
    } catch (err) {
        if (String(err).indexOf('EventExit') === -1) {
            console.error('[WarClaimsHook] Erreur broken : ' + err)
        }
    }
})

// -----------------------------------------------------------------------------
// 3. CONTRÔLE DE LA CONSTRUCTION (BlockEvents.placed)
// -----------------------------------------------------------------------------
BlockEvents.placed(function (event) {
    try {
        var player = event.player
        if (!player || player.isFake()) return
        var level = event.level
        if (!level || level.isClientSide()) return
        var server = level.server

        var pos = event.block.getPos()
        var bx = pos.getX()
        var bz = pos.getZ()

        // Protection inviolable de l'ONU
        if (isLevelOverworld(level)) {
            if (typeof isPositionInOnuClaim === 'function' && isPositionInOnuClaim(level, bx, bz)) {
                event.cancel()
                return
            }
        }

        var defendingTeam = getChunkOwningTeam(level, bx, bz)
        if (!defendingTeam) return // Zone sauvage libre

        var sName = defendingTeam.getShortName() ? String(defendingTeam.getShortName()).toLowerCase() : ''
        if (sName === 'onu' || String(defendingTeam.getId()) === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
            event.cancel()
            return
        }

        var attackingTeam = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(player) : null
        if (attackingTeam && String(attackingTeam.getId()) === String(defendingTeam.getId())) {
            return // Membre de sa propre nation
        }

        // 1. Vérification de Conflit CTF
        if (attackingTeam && typeof getActiveConflictBetween === 'function') {
            var conflict = getActiveConflictBetween(server, attackingTeam.getId(), defendingTeam.getId())
            if (conflict) {
                if (conflict.status === 'ACTIVE') {
                    var blockId = event.block.getId()
                    // Autoriser échafaudages, échelles, torches pour progresser et franchir les obstacles
                    if (blockId.includes('scaffolding') || blockId.includes('ladder') || blockId.includes('torch')) {
                        setPlayerWarBypass(player, true)
                        return
                    }
                    sendMsg(player, 'Conflit', 'En Conflit, seules les échelles, échafaudages et torches peuvent être posés. Utilisez votre pioche pour forcer le passage.', '§e')
                    event.cancel()
                    return
                } else {
                    event.cancel()
                    return
                }
            }
        }

        // 2. Vérification de guerre déclarée (Siège)
        if (attackingTeam && typeof isNationAtWarWith === 'function' && isNationAtWarWith(server, attackingTeam.getId(), defendingTeam.getId())) {
            if (typeof isRaidHourActive === 'function' && isRaidHourActive()) {
                // Pose autorisée en Raid Hours pour le siège
                setPlayerWarBypass(player, true)
                return
            } else {
                sendMsg(player, 'Guerre', 'La pose de blocs en territoire ennemi n\'est autorisée qu\'en Raid Hours (18h-22h) ! Tapez §e/war raidhours force §cpour tester en tant que Staff.', '§c')
                event.cancel()
                return
            }
        }

        // Non allié et non ennemi : refus catégorique
        event.cancel()
    } catch (err) {
        if (String(err).indexOf('EventExit') === -1) {
            console.error('[WarClaimsHook] Erreur placed : ' + err)
        }
    }
})

// -----------------------------------------------------------------------------
// 4. CONTRÔLE DES EXPLOSIONS (Canons Create Big Cannons, Missiles Ballistix, TNT)
// -----------------------------------------------------------------------------
LevelEvents.beforeExplosion(function (event) {
    try {
        var level = event.level
        if (!level || level.isClientSide()) return
        var server = level.server
        if (!server) return

        var blockX = Math.floor(event.x)
        var blockZ = Math.floor(event.z)
        var chunkX = blockX >> 4
        var chunkZ = blockZ >> 4

        // 1. Neutralisation absolue dans les Chunks Sanctuaires Admin (0% dégât de bloc)
        if (typeof isSanctuaryChunk === 'function' && isSanctuaryChunk(level, chunkX, chunkZ)) {
            event.cancel()
            try {
                if (typeof triggerSanctuaryFeedback === 'function') {
                    triggerSanctuaryFeedback(level, event.x, event.y, event.z, chunkX, chunkZ, event.exploder)
                }
            } catch (fe) { }
            return
        }

        // 2. Neutralisation absolue de toute explosion dans les territoires revendiqués par l'ONU
        if (isLevelOverworld(level)) {
            if (typeof isPositionInOnuClaim === 'function' && isPositionInOnuClaim(level, blockX, blockZ)) {
                event.cancel()
                return
            }
        }

        var defendingTeam = getChunkOwningTeam(level, blockX, blockZ)
        if (!defendingTeam) return // Zone neutre/sauvage : explosion autorisée normalement

        // Si c'est le territoire de l'ONU : invulnérabilité absolue aux explosions
        var sName = defendingTeam.getShortName() ? String(defendingTeam.getShortName()).toLowerCase() : ''
        if (sName === 'onu' || String(defendingTeam.getId()) === 'cb440140-1d45-4eff-9b10-2bab3d457d63') {
            event.cancel()
            return
        }

        var exploder = event.exploder

        // 3. Exception Mobs Vanilla : Si c'est un mob vanilla (creeper, ghast, wither, etc.), on laisse exploser
        if (isVanillaMobExplosion(exploder)) {
            return
        }

        // 5. Si la nation cible n'est dans aucune guerre active : Invulnérabilité 100% face aux attaques extérieures
        var defWars = getTeamActiveWars(server, defendingTeam.getId())
        if (!defWars || defWars.length === 0) {
            event.cancel()
            return
        }

        var isRaid = (typeof isRaidHourActive === 'function' && isRaidHourActive())
        if (!isRaid) {
            event.cancel()
            return
        }

        // Si l'explosion a un auteur joueur identifié
        var attackingPlayer = null
        if (exploder) {
            if (exploder.isPlayer()) {
                attackingPlayer = exploder
            } else {
                try {
                    if (exploder.getOwner && exploder.getOwner() && exploder.getOwner().isPlayer()) {
                        attackingPlayer = exploder.getOwner()
                    }
                } catch (oe) { }
            }
        }

        if (attackingPlayer) {
            var attackingTeam = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(attackingPlayer) : null
            if (attackingTeam && String(attackingTeam.getId()) !== String(defendingTeam.getId())) {
                if (!isNationAtWarWith(server, attackingTeam.getId(), defendingTeam.getId())) {
                    sendMsg(attackingPlayer, 'Défense', 'Cette nation n\'est pas votre ennemie de guerre déclarée ! Dégâts impossibles.', '§c')
                    event.cancel()
                    return
                }
            }
        }
        // Guerre active confirmée en période de Raid Hours : DÉGÂTS D'EXPLOSION 100% AUTORISÉS !
    } catch (err) {
        if (String(err).indexOf('EventExit') === -1) {
            console.error('[WarClaimsHook] Erreur beforeExplosion : ' + err)
        }
    }
})

// -----------------------------------------------------------------------------
// 5. CONTRÔLE DES INTERACTIONS (Portes, Trappes, Leviers) EN GUERRE
// -----------------------------------------------------------------------------
BlockEvents.rightClicked(function (event) {
    try {
        var player = event.player
        if (!player || player.isFake()) return
        var level = event.level
        if (!level || level.isClientSide()) return
        var server = level.server

        var blockPos = event.block.getPos()
        var bx = blockPos.getX()
        var bz = blockPos.getZ()

        if (shouldAllowWarAction(player, level, bx, bz)) {
            setPlayerWarBypass(player, true)
        }

        var defendingTeam = getChunkOwningTeam(level, bx, bz)
        if (!defendingTeam) return

        var attackingTeam = (typeof getPlayerNationTeam === 'function') ? getPlayerNationTeam(player) : null
        if (!attackingTeam) return

        // 1. Vérification de Conflit CTF
        if (attackingTeam && typeof getActiveConflictBetween === 'function') {
            var conflict = getActiveConflictBetween(server, attackingTeam.getId(), defendingTeam.getId())
            if (conflict && conflict.status === 'ACTIVE') {
                var blockIdC = event.block.getId()
                // Blocage formel du pillage des conteneurs en Conflit (interdiction absolue de voler dans les coffres)
                if (blockIdC.includes('chest') || blockIdC.includes('barrel') || blockIdC.includes('shulker') || blockIdC.includes('drawer') || blockIdC.includes('crate') || blockIdC.includes('hopper')) {
                    sendMsg(player, 'Conflit', 'Le pillage des coffres est strictement interdit en Conflit ! Seul l\'autel adverse est ciblé.', '§c')
                    event.cancel()
                    return
                }
                // Autoriser l'ouverture des portes, trappes, boutons et leviers ennemis pour progresser
                if (blockIdC.includes('door') || blockIdC.includes('trapdoor') || blockIdC.includes('button') || blockIdC.includes('lever') || blockIdC.includes('gate')) {
                    return
                }
                // Autoriser l'interaction avec l'Autel National adverse pour l'extraction de l'Étendard
                if (typeof loadAltarsData === 'function') {
                    var altarsC = loadAltarsData()
                    var defAltar = altarsC[defendingTeam.getId().toString()]
                    if (defAltar && defAltar.x === bx && defAltar.y === blockPos.getY() && defAltar.z === bz) {
                        return
                    }
                }
            }
        }

        // 2. Vérification de guerre déclarée (Siège)
        if (typeof isNationAtWarWith === 'function' && isNationAtWarWith(server, attackingTeam.getId(), defendingTeam.getId())) {
            if (typeof isRaidHourActive === 'function' && isRaidHourActive()) {
                var blockId = event.block.getId()
                // Autoriser l'ouverture des portes, trappes, boutons et leviers ennemis en Raid Hours
                if (blockId.includes('door') || blockId.includes('trapdoor') || blockId.includes('button') || blockId.includes('lever') || blockId.includes('gate')) {
                    return
                }
            }
        }
    } catch (e) { }
})
