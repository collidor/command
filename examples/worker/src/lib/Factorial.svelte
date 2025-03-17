<script lang="ts">
  import { commandBus } from "./commandBus";
  import { GetFactorialCommand } from "./commands/getFactorial.command";

  let value: number = $state(0)
  let result: number = $state(1)

  function getFactorial(n: number) {
    commandBus.execute(new GetFactorialCommand(n)).then((res) => {
      result = res;
    });
  }
</script>

<input type="number" bind:value={value} />
<button onclick={() => getFactorial(value)}>
  Get Factorial
</button>
<br>
<h2>{result}</h2>
