-- pob-commands.lua
-- Lua-side command dispatcher for the pob-web worker.
-- These functions are called from JS via bridge_call_json().
-- They interact with PoB's internal state through the global 'build' object
-- that HeadlessWrapper.lua sets up.

local json = require("dkjson") -- PoB bundles dkjson

-- Load a build from XML string
function pobWebLoadBuild(jsonStr)
    local ok, args = pcall(json.decode, jsonStr)
    if not ok or not args or not args.xml then
        return json.encode({ error = "Invalid arguments" })
    end

    local success, err = pcall(function()
        loadBuildFromXML(args.xml)
    end)

    if not success then
        return json.encode({ error = tostring(err) })
    end

    -- Trigger a full calculation
    pcall(function()
        build.buildFlag = true
        runCallback("OnFrame")
    end)

    return json.encode({ success = true })
end

-- Get calculated stats from the current build
function pobWebGetStats(jsonStr)
    local stats = {}

    local success, err = pcall(function()
        if not build or not build.calcsTab then
            error("No build loaded")
        end

        local output = build.calcsTab.mainOutput
        if not output then
            error("No calculation output available")
        end

        -- Offence stats
        stats.totalDps = output.TotalDPS or output.CombinedDPS or 0
        stats.hitDps = output.TotalDot and (stats.totalDps - output.TotalDot) or stats.totalDps
        stats.dotDps = output.TotalDot or 0
        stats.critChance = output.CritChance or 0
        stats.critMulti = output.CritMultiplier or 0
        stats.attackSpeed = output.Speed or 0
        stats.castSpeed = output.Speed or 0
        stats.hitDamage = output.AverageDamage or 0

        -- Defence stats
        local actor = build.calcsTab.mainEnv and build.calcsTab.mainEnv.player or {}
        local actorOutput = actor.output or output

        stats.life = actorOutput.Life or 0
        stats.energyShield = actorOutput.EnergyShield or 0
        stats.mana = actorOutput.Mana or 0
        stats.armour = actorOutput.Armour or 0
        stats.evasion = actorOutput.Evasion or 0
        stats.blockChance = actorOutput.BlockChance or 0

        -- Resistances
        stats.fireRes = actorOutput.FireResist or 0
        stats.coldRes = actorOutput.ColdResist or 0
        stats.lightningRes = actorOutput.LightningResist or 0
        stats.chaosRes = actorOutput.ChaosResist or 0

        -- Misc
        stats.movementSpeed = actorOutput.MovementSpeedMod or 0
    end)

    if not success then
        return json.encode({ error = tostring(err) })
    end

    return json.encode(stats)
end

-- Get node power data for heatmap visualization
function pobWebGetNodePower(jsonStr)
    local ok, args = pcall(json.decode, jsonStr)
    if not ok then args = {} end

    local stat = args.stat or "dps"
    local nodePower = {}

    local success, err = pcall(function()
        if not build or not build.calcsTab or not build.spec then
            error("No build loaded")
        end

        -- PoB calculates node power internally
        -- We need to access it from the power report or calculate it
        local powerStat
        if stat == "dps" then
            powerStat = "dps"
        elseif stat == "life" then
            powerStat = "life"
        elseif stat == "es" then
            powerStat = "es"
        else
            powerStat = "dps"
        end

        -- Access node power from PoB's power report system
        if build.spec and build.spec.nodes then
            for nodeId, node in pairs(build.spec.nodes) do
                if node.power and node.power[powerStat] then
                    nodePower[nodeId] = node.power[powerStat]
                end
            end
        end
    end)

    if not success then
        return json.encode({ error = tostring(err) })
    end

    return json.encode(nodePower)
end

print("[pob-web] Command dispatcher loaded")
