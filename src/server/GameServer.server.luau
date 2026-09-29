-- Builds the world, hands out rewards, and saves each player's seed count.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local DataStoreService = game:GetService("DataStoreService")
local Lighting = game:GetService("Lighting")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local rng = Random.new()
local half = Config.WorldSize / 2

local worldFolder = Instance.new("Folder")
worldFolder.Name = "BirdWorld"
worldFolder.Parent = workspace

local function makePart(props)
	local part = Instance.new("Part")
	part.Anchored = true
	part.TopSurface = Enum.SurfaceType.Smooth
	part.BottomSurface = Enum.SurfaceType.Smooth
	for key, value in props do
		part[key] = value
	end
	part.Parent = props.Parent or worldFolder
	return part
end

local function randomGroundPoint(margin)
	margin = margin or 40
	return Vector3.new(rng:NextNumber(-half + margin, half - margin), 0, rng:NextNumber(-half + margin, half - margin))
end

---------------------------------------------------------------------------
-- World
---------------------------------------------------------------------------

Lighting.ClockTime = 14
Lighting.Brightness = 2
Lighting.OutdoorAmbient = Color3.fromRGB(150, 160, 180)

makePart({
	Name = "Ground",
	Size = Vector3.new(Config.WorldSize, 4, Config.WorldSize),
	Position = Vector3.new(0, -2, 0),
	Color = Color3.fromRGB(96, 168, 72),
	Material = Enum.Material.Grass,
})

-- A shallow lake in the middle of the map.
makePart({
	Name = "Lake",
	Shape = Enum.PartType.Cylinder,
	Size = Vector3.new(0.4, 160, 160),
	CFrame = CFrame.new(0, 0.1, 0) * CFrame.Angles(0, 0, math.rad(90)),
	Color = Color3.fromRGB(64, 140, 220),
	Material = Enum.Material.Glass,
	Transparency = 0.2,
	CanCollide = false,
})

-- Invisible walls keep birds inside the map.
for _, wall in {
	{ Vector3.new(Config.WorldSize, 800, 4), Vector3.new(0, 400, half) },
	{ Vector3.new(Config.WorldSize, 800, 4), Vector3.new(0, 400, -half) },
	{ Vector3.new(4, 800, Config.WorldSize), Vector3.new(half, 400, 0) },
	{ Vector3.new(4, 800, Config.WorldSize), Vector3.new(-half, 400, 0) },
} do
	makePart({ Name = "Boundary", Size = wall[1], Position = wall[2], Transparency = 1 })
end

-- Nest spawn on a tall tree near the lake.
local nestPos = Vector3.new(0, 60, 110)
makePart({
	Name = "NestTrunk",
	Size = Vector3.new(8, 60, 8),
	Position = nestPos - Vector3.new(0, 30, 0),
	Color = Color3.fromRGB(110, 72, 40),
	Material = Enum.Material.Wood,
})
local spawn = Instance.new("SpawnLocation")
spawn.Name = "Nest"
spawn.Anchored = true
spawn.Shape = Enum.PartType.Cylinder
spawn.Size = Vector3.new(2, 24, 24)
spawn.CFrame = CFrame.new(nestPos) * CFrame.Angles(0, 0, math.rad(90))
spawn.Color = Color3.fromRGB(160, 120, 70)
spawn.Material = Enum.Material.WoodPlanks
spawn.Duration = 0
spawn.Parent = worldFolder

local function makeTree(pos)
	local height = rng:NextNumber(25, 60)
	makePart({
		Name = "Trunk",
		Size = Vector3.new(4, height, 4),
		Position = pos + Vector3.new(0, height / 2, 0),
		Color = Color3.fromRGB(110, 72, 40),
		Material = Enum.Material.Wood,
	})
	local leafSize = rng:NextNumber(18, 30)
	makePart({
		Name = "Leaves",
		Shape = Enum.PartType.Ball,
		Size = Vector3.new(leafSize, leafSize, leafSize),
		Position = pos + Vector3.new(0, height, 0),
		Color = Color3.fromRGB(46, rng:NextInteger(110, 150), 52),
		Material = Enum.Material.Grass,
	})
	return pos + Vector3.new(0, height + leafSize / 2, 0)
end

local treeTops = {}
for _ = 1, Config.TreeCount do
	local pos = randomGroundPoint()
	if pos.Magnitude > 100 then -- keep the lake clear
		table.insert(treeTops, makeTree(pos))
	end
end

local islandTops = {}
for _ = 1, Config.IslandCount do
	local pos = randomGroundPoint(80) + Vector3.new(0, rng:NextNumber(120, 260), 0)
	local size = rng:NextNumber(40, 80)
	makePart({
		Name = "IslandRock",
		Size = Vector3.new(size, 20, size),
		Position = pos - Vector3.new(0, 12, 0),
		Color = Color3.fromRGB(120, 110, 100),
		Material = Enum.Material.Slate,
	})
	makePart({
		Name = "IslandGrass",
		Size = Vector3.new(size, 4, size),
		Position = pos,
		Color = Color3.fromRGB(96, 168, 72),
		Material = Enum.Material.Grass,
	})
	table.insert(islandTops, pos + Vector3.new(0, 2, 0))
end

---------------------------------------------------------------------------
-- Leaderstats and saving
---------------------------------------------------------------------------

local store = nil
pcall(function()
	store = DataStoreService:GetDataStore("BirdGame_v1")
end)

local function getSeeds(player)
	local stats = player:FindFirstChild("leaderstats")
	return stats and stats:FindFirstChild("Seeds")
end

local function addSeeds(player, amount)
	local seeds = getSeeds(player)
	if seeds then
		seeds.Value += amount
	end
end

local function savePlayer(player)
	local seeds = getSeeds(player)
	if store and seeds then
		local ok, err = pcall(function()
			store:SetAsync(tostring(player.UserId), seeds.Value)
		end)
		if not ok then
			warn("Failed to save " .. player.Name .. ": " .. tostring(err))
		end
	end
end

---------------------------------------------------------------------------
-- Bird wings (cosmetic, welded to the torso)
---------------------------------------------------------------------------

local function addWings(character)
	local torso = character:WaitForChild("UpperTorso", 5) or character:WaitForChild("Torso", 5)
	if not torso then
		return
	end
	for _, side in { -1, 1 } do
		local wing = Instance.new("Part")
		wing.Name = side < 0 and "LeftWing" or "RightWing"
		wing.Size = Vector3.new(5, 0.3, 2.2)
		wing.Color = Color3.fromRGB(245, 245, 245)
		wing.Material = Enum.Material.SmoothPlastic
		wing.CanCollide = false
		wing.CanQuery = false
		wing.CanTouch = false
		wing.Massless = true
		wing.Parent = character

		local weld = Instance.new("Motor6D")
		weld.Name = wing.Name .. "Joint"
		weld.Part0 = torso
		weld.Part1 = wing
		weld.C0 = CFrame.new(side * 0.6, 0.4, 0.6)
		weld.C1 = CFrame.new(-side * 2.5, 0, 0)
		weld.Parent = torso
	end
end

Players.PlayerAdded:Connect(function(player)
	local stats = Instance.new("Folder")
	stats.Name = "leaderstats"
	local seeds = Instance.new("IntValue")
	seeds.Name = "Seeds"
	seeds.Parent = stats
	stats.Parent = player

	if store then
		local ok, saved = pcall(function()
			return store:GetAsync(tostring(player.UserId))
		end)
		if ok and typeof(saved) == "number" then
			seeds.Value = saved
		end
	end

	player.CharacterAdded:Connect(addWings)
	if player.Character then
		addWings(player.Character)
	end
end)

Players.PlayerRemoving:Connect(savePlayer)
game:BindToClose(function()
	for _, player in Players:GetPlayers() do
		savePlayer(player)
	end
end)

---------------------------------------------------------------------------
-- Collectibles
---------------------------------------------------------------------------

local function playerFromHit(hit)
	local character = hit:FindFirstAncestorOfClass("Model")
	return character and Players:GetPlayerFromCharacter(character)
end

local function spawnSeed(position, golden)
	local seed = makePart({
		Name = golden and "GoldenSeed" or "Seed",
		Shape = Enum.PartType.Ball,
		Size = golden and Vector3.new(3, 3, 3) or Vector3.new(1.6, 1.6, 1.6),
		Position = position,
		Color = golden and Color3.fromRGB(255, 200, 40) or Color3.fromRGB(230, 190, 110),
		Material = Enum.Material.Neon,
		CanCollide = false,
	})
	local light = Instance.new("PointLight")
	light.Color = seed.Color
	light.Range = golden and 14 or 6
	light.Parent = seed

	local collected = false
	seed.Touched:Connect(function(hit)
		if collected then
			return
		end
		local player = playerFromHit(hit)
		if not player then
			return
		end
		collected = true
		addSeeds(player, golden and Config.GoldenSeedValue or Config.SeedValue)
		seed.Transparency = 1
		light.Enabled = false
		task.delay(Config.SeedRespawnTime, function()
			seed.Transparency = 0
			light.Enabled = true
			collected = false
		end)
	end)
end

for _ = 1, Config.SeedCount do
	-- Most seeds float low over the meadow; some sit on treetops.
	if #treeTops > 0 and rng:NextNumber() < 0.35 then
		spawnSeed(treeTops[rng:NextInteger(1, #treeTops)] + Vector3.new(0, 2, 0), false)
	else
		spawnSeed(randomGroundPoint() + Vector3.new(0, rng:NextNumber(3, 40), 0), false)
	end
end

for i = 1, Config.GoldenSeedCount do
	-- Golden seeds live on the floating islands.
	local top = islandTops[(i - 1) % math.max(#islandTops, 1) + 1]
	if top then
		spawnSeed(top + Vector3.new(rng:NextNumber(-10, 10), 3, rng:NextNumber(-10, 10)), true)
	end
end

-- Hoops to fly through, spread out in the sky.
for _ = 1, Config.RingCount do
	local pos = randomGroundPoint(60) + Vector3.new(0, rng:NextNumber(40, 200), 0)
	local facing = CFrame.new(pos) * CFrame.Angles(0, rng:NextNumber(0, math.pi * 2), 0)
	local ringModel = Instance.new("Model")
	ringModel.Name = "Ring"
	ringModel.Parent = worldFolder

	-- Build the hoop out of short segments.
	local radius, segments = 14, 16
	for s = 1, segments do
		local angle = (s / segments) * math.pi * 2
		makePart({
			Name = "Segment",
			Size = Vector3.new(1.5, 1.5, radius * 2 * math.pi / segments + 0.3),
			CFrame = facing * CFrame.Angles(0, 0, angle) * CFrame.new(0, radius, 0) * CFrame.Angles(0, math.rad(90), 0),
			Color = Color3.fromRGB(255, 90, 160),
			Material = Enum.Material.Neon,
			CanCollide = false,
			Parent = ringModel,
		})
	end

	local gate = makePart({
		Name = "Gate",
		Shape = Enum.PartType.Cylinder,
		Size = Vector3.new(1, radius * 2 - 2, radius * 2 - 2),
		CFrame = facing * CFrame.Angles(0, math.rad(90), 0),
		Transparency = 1,
		CanCollide = false,
		Parent = ringModel,
	})

	local lastUse = {}
	gate.Touched:Connect(function(hit)
		local player = playerFromHit(hit)
		if not player then
			return
		end
		local now = os.clock()
		if lastUse[player] and now - lastUse[player] < Config.RingCooldown then
			return
		end
		lastUse[player] = now
		addSeeds(player, Config.RingValue)
	end)
	Players.PlayerRemoving:Connect(function(player)
		lastUse[player] = nil
	end)
end
