-- Tuning values shared by server and client.
local Config = {
	-- Flight
	FlySpeed = 55, -- horizontal cruise speed (studs/s)
	DiveSpeed = 110, -- horizontal speed while holding Shift
	FlapPower = 45, -- upward velocity set by one flap
	GlideGravity = 35, -- downward acceleration while gliding (world gravity is ~196)
	MaxFallSpeed = 40, -- terminal velocity while gliding
	DiveFallSpeed = 120, -- terminal velocity while diving
	TurnResponsiveness = 4, -- how quickly velocity steers toward input

	-- Stamina
	MaxStamina = 100,
	FlapCost = 12,
	StaminaRegenGround = 40, -- per second, when standing
	StaminaRegenGlide = 6, -- per second, while gliding

	-- World
	WorldSize = 1200,
	SeedCount = 120,
	GoldenSeedCount = 12,
	RingCount = 18,
	TreeCount = 60,
	IslandCount = 10,

	-- Rewards
	SeedValue = 1,
	GoldenSeedValue = 5,
	RingValue = 10,
	SeedRespawnTime = 20,
	RingCooldown = 5,
}

return Config
