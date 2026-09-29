-- Flight controls for the local bird.
-- Space in the air: start flying / flap. Shift: dive. Land on anything to walk again.

local Players = game:GetService("Players")
local RunService = game:GetService("RunService")
local UserInputService = game:GetService("UserInputService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local player = Players.LocalPlayer

---------------------------------------------------------------------------
-- HUD
---------------------------------------------------------------------------

local gui = Instance.new("ScreenGui")
gui.Name = "BirdHud"
gui.ResetOnSpawn = false
gui.Parent = player:WaitForChild("PlayerGui")

local barBack = Instance.new("Frame")
barBack.AnchorPoint = Vector2.new(0.5, 1)
barBack.Position = UDim2.new(0.5, 0, 1, -24)
barBack.Size = UDim2.fromOffset(260, 16)
barBack.BackgroundColor3 = Color3.fromRGB(30, 30, 40)
barBack.BackgroundTransparency = 0.3
barBack.Parent = gui
Instance.new("UICorner", barBack).CornerRadius = UDim.new(1, 0)

local barFill = Instance.new("Frame")
barFill.Size = UDim2.fromScale(1, 1)
barFill.BackgroundColor3 = Color3.fromRGB(120, 200, 255)
barFill.Parent = barBack
Instance.new("UICorner", barFill).CornerRadius = UDim.new(1, 0)

local hint = Instance.new("TextLabel")
hint.AnchorPoint = Vector2.new(0.5, 1)
hint.Position = UDim2.new(0.5, 0, 1, -46)
hint.Size = UDim2.fromOffset(460, 24)
hint.BackgroundTransparency = 1
hint.Font = Enum.Font.GothamBold
hint.TextSize = 16
hint.TextColor3 = Color3.new(1, 1, 1)
hint.TextStrokeTransparency = 0.5
hint.Text = "Jump, then press SPACE in the air to fly. Hold SHIFT to dive."
hint.Parent = gui

---------------------------------------------------------------------------
-- Flight state
---------------------------------------------------------------------------

local stamina = Config.MaxStamina
local flying = false
local diving = false
local flapTimer = 0 -- drives the wing animation
local sinceFlap = math.huge

local character, humanoid, root, align, attachment
local leftJoint, rightJoint

local function setFlying(on)
	if flying == on or not humanoid then
		return
	end
	flying = on
	humanoid.PlatformStand = on
	align.Enabled = on
	if not on then
		humanoid:ChangeState(Enum.HumanoidStateType.GettingUp)
		hint.Text = "Jump, then press SPACE in the air to fly. Hold SHIFT to dive."
	else
		hint.Text = "SPACE: flap   SHIFT: dive   Collect seeds and fly through rings!"
	end
end

local function flap()
	if stamina < Config.FlapCost then
		return
	end
	stamina -= Config.FlapCost
	sinceFlap = 0
	flapTimer = 0
	local v = root.AssemblyLinearVelocity
	root.AssemblyLinearVelocity = Vector3.new(v.X, math.max(v.Y, 0) + Config.FlapPower, v.Z)
end

local function onCharacter(char)
	character = char
	humanoid = char:WaitForChild("Humanoid")
	root = char:WaitForChild("HumanoidRootPart")
	flying = false
	stamina = Config.MaxStamina

	attachment = Instance.new("Attachment")
	attachment.Name = "FlightAttachment"
	attachment.Parent = root

	align = Instance.new("AlignOrientation")
	align.Mode = Enum.OrientationAlignmentMode.OneAttachment
	align.Attachment0 = attachment
	align.RigidityEnabled = false
	align.Responsiveness = 25
	align.MaxTorque = math.huge
	align.Enabled = false
	align.Parent = root

	local torso = char:WaitForChild("UpperTorso", 5) or char:WaitForChild("Torso", 5)
	leftJoint = torso and torso:WaitForChild("LeftWingJoint", 5)
	rightJoint = torso and torso:WaitForChild("RightWingJoint", 5)

	humanoid.Died:Connect(function()
		flying = false
	end)
end

player.CharacterAdded:Connect(onCharacter)
if player.Character then
	task.spawn(onCharacter, player.Character)
end

local function tryFlap()
	if not humanoid or humanoid.Health <= 0 then
		return
	end
	if flying then
		flap()
	elseif humanoid.FloorMaterial == Enum.Material.Air then
		setFlying(true)
		flap()
	end
end

UserInputService.InputBegan:Connect(function(input)
	-- Space is also bound to jump, so it can arrive marked as processed; only ignore it while typing.
	if UserInputService:GetFocusedTextBox() then
		return
	end
	if input.KeyCode == Enum.KeyCode.Space or input.KeyCode == Enum.KeyCode.ButtonA then
		tryFlap()
	elseif input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.ButtonL2 then
		diving = true
	end
end)

UserInputService.InputEnded:Connect(function(input)
	if input.KeyCode == Enum.KeyCode.LeftShift or input.KeyCode == Enum.KeyCode.ButtonL2 then
		diving = false
	end
end)

-- Mobile: the on-screen jump button flaps. JumpRequest can fire several times per tap, so debounce it.
UserInputService.JumpRequest:Connect(function()
	if UserInputService.TouchEnabled and not UserInputService.KeyboardEnabled and sinceFlap > 0.2 then
		tryFlap()
	end
end)

local groundParams = RaycastParams.new()
groundParams.FilterType = Enum.RaycastFilterType.Exclude

local function updateWings(dt)
	if not (leftJoint and rightJoint) then
		return
	end
	local angle
	if flying then
		flapTimer += dt
		if sinceFlap < 0.35 then
			angle = math.sin(flapTimer * 28) * math.rad(55) -- strong beat after a flap
		elseif diving then
			angle = math.rad(-35) -- tucked
		else
			angle = math.sin(flapTimer * 3) * math.rad(6) + math.rad(8) -- soaring
		end
	else
		angle = math.rad(-60) -- folded while walking
	end
	leftJoint.Transform = CFrame.Angles(0, 0, -angle)
	rightJoint.Transform = CFrame.Angles(0, 0, angle)
end

RunService.RenderStepped:Connect(updateWings)

RunService.Heartbeat:Connect(function(dt)
	if not (humanoid and root and humanoid.Health > 0) then
		return
	end
	sinceFlap += dt

	if not flying then
		if humanoid.FloorMaterial ~= Enum.Material.Air then
			stamina = math.min(Config.MaxStamina, stamina + Config.StaminaRegenGround * dt)
		end
	else
		stamina = math.min(Config.MaxStamina, stamina + Config.StaminaRegenGlide * dt)

		local v = root.AssemblyLinearVelocity
		local moveDir = humanoid.MoveDirection
		local speed = diving and Config.DiveSpeed or Config.FlySpeed

		-- Steer horizontal velocity toward the input direction (keep momentum when idle).
		local horizontal = Vector3.new(v.X, 0, v.Z)
		local target = moveDir.Magnitude > 0.05 and moveDir * speed or horizontal * 0.98
		horizontal = horizontal:Lerp(target, math.clamp(Config.TurnResponsiveness * dt, 0, 1))

		-- Cancel most of the world gravity so birds glide.
		local vy = v.Y + (workspace.Gravity - Config.GlideGravity * (diving and 3 or 1)) * dt
		vy = math.max(vy, -(diving and Config.DiveFallSpeed or Config.MaxFallSpeed))
		root.AssemblyLinearVelocity = Vector3.new(horizontal.X, vy, horizontal.Z)

		-- Face the direction of travel, pitched with climb/dive and banked into turns.
		local look = horizontal.Magnitude > 1 and horizontal.Unit or root.CFrame.LookVector * Vector3.new(1, 0, 1)
		if look.Magnitude < 0.01 then
			look = Vector3.new(0, 0, -1)
		end
		look = look.Unit
		local pitch = math.clamp(vy / 80, -1, 0.6) * math.rad(50)
		local bank = 0
		if moveDir.Magnitude > 0.05 then
			bank = look:Cross(moveDir).Y * math.rad(35) -- dip the inside wing
		end
		local pitchDown = diving and math.rad(-70) or math.rad(-60) -- lean the body forward to fly horizontally
		align.CFrame = CFrame.lookAt(Vector3.zero, look) * CFrame.Angles(0, 0, bank) * CFrame.Angles(pitchDown + pitch, 0, 0)

		-- Land when close to the ground and not climbing.
		if vy <= 0 and sinceFlap > 0.4 then
			groundParams.FilterDescendantsInstances = { character }
			if workspace:Raycast(root.Position, Vector3.new(0, -4, 0), groundParams) then
				setFlying(false)
			end
		end
	end

	barFill.Size = UDim2.fromScale(stamina / Config.MaxStamina, 1)
	barFill.BackgroundColor3 = stamina < Config.FlapCost and Color3.fromRGB(255, 110, 110)
		or Color3.fromRGB(120, 200, 255)
end)
