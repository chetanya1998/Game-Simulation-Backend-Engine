namespace SwarmRescue
{
    /// Gameplay tuning constants. Economy values live in config/economy.json.
    public static class Tuning
    {
        public const int HeroMaxHp = 100;
        public const int LaserDamage = 10;
        public const float FireRatePerSecond = 4f;

        public const int DroneHp = 20;
        public const int DroneContactDamage = 5;

        public const int BossPhases = 3;
        public const int BossTotalHp = 1500;

        public const float ComboStepPerKill = 0.1f;
        public const float ComboMax = 3f;
        public const float NearMissSlowMoSeconds = 1.5f;

        public static readonly int[] WavesPerLevel = { 3, 4, 5, 6, 6 };
    }
}
