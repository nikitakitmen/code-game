<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AchievementUnlock extends Model
{
    public $timestamps = false;
    protected $fillable = ['profile_id', 'achievement_id', 'unlocked_at'];
    protected $casts = ['unlocked_at' => 'datetime'];
}
