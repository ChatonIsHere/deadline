import { Injectable } from '@nestjs/common';
import { Button, type ButtonContext, ComponentParam, Context } from 'necord';
import { CrewsService } from '../crews/crews.service';
import { explain } from './gig.interactions';

/** Join and Decline on a crew invite DM. The DM is replaced by the answer. */
@Injectable()
export class CrewInteractions {
    constructor(private readonly crews: CrewsService) {}

    @Button('crew/accept/:crew/:runner')
    accept(@Context() [interaction]: ButtonContext, @ComponentParam('crew') crew: string, @ComponentParam('runner') runner: string) {
        return this.answer(interaction, () => this.crews.accept(interaction.user.id, Number(crew), Number(runner)));
    }

    @Button('crew/decline/:crew/:runner')
    decline(@Context() [interaction]: ButtonContext, @ComponentParam('crew') crew: string, @ComponentParam('runner') runner: string) {
        return this.answer(interaction, () => this.crews.decline(interaction.user.id, Number(crew), Number(runner)));
    }

    private async answer(interaction: ButtonContext[0], action: () => string) {
        try {
            await interaction.update({ content: action(), components: [] });
        } catch (err) {
            await interaction.reply(explain(err));
        }
    }
}
