<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class GameSave extends Model
{
    public $timestamps = false;
    protected $fillable = ['profile_id', 'schema_version', 'revision', 'state_json', 'simulation_seed', 'checkpoint_type', 'label', 'mission_id', 'created_at'];
    protected $casts = ['created_at' => 'datetime'];
}
